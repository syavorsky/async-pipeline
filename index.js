const {EventEmitter} = require('events')

const noop = () => {}

function _timeSince(startedAt) {
  const [sec, nsec] = process.hrtime(startedAt)
  return parseInt(sec * 1e3 + nsec / 1e6)
}

class PipelineError extends Error {
  constructor(...args) {
    super(...args)
    this.isPipelineError = true
  }
}

function di ({
  timeSince = _timeSince,
} = {}) {

  return function AsyncPipeline (options = {}) {

    if (!(this instanceof AsyncPipeline)) return new AsyncPipeline(options)

    const {
      debug = noop,
      transitions = null
    } = options

    if (transitions !== null) {
      for (const t in transitions) {
        if (transitions.hasOwnProperty(t)) transitions[t] = new Set(transitions[t])
      }
    }

    const ee = new EventEmitter()
    const routes = []
    const handlers = {}

    let ended = false
    let startedAt

    const end = err => {
      ended = true
      if (err) {
        if (handlers['@error']) ee.emit('@error', null, err)
        else  {
          console.error('\n☠︎ Pipeline crashed, listen to "@error" to prevent throwing\n')
          throw err
        }
      }
      ee.emit('@end', null, routes.slice())
    }

    function trace(routes, event, payload = []) {
      const route = {event, payload, routes: [], time: timeSince(startedAt)}
      routes.push(route)
      return route.routes
    }

    function start(event, ...payload) {
      if (routes[0]) {
        throw new PipelineError('Pipeline has already started with ' +
          `${routes[0].name} : ${JSON.stringify(routes[0].payload)}`)
      }

      if (transitions && !transitions[event]) throw new PipelineError(`Event "${event}" is not allowed entry point`)

      startedAt = process.hrtime();
      ee.emit(event, trace(routes, event, payload), ...payload)

      return this
    }

    function on (event, fn) {
      if (ended) throw new PipelineError('Can not add handlers after pipeline closed')
      if (routes[0]) throw new PipelineError('Can not add handlers after pipeline started')

      // track events being handled
      handlers[event] = (handlers[event] || 0) + 1

      ee.on(event, (routes, ...payload) => {
        const isInternal = event[0] === '@'
        debug('◆', event, payload)

        // skip
        if (ended && !isInternal) return this.debug(`✘ Pipeline closed, skipping ${event}`, ...payload)

        // let @-events handles fail unsafe
        // if (isInternal) return setTimeout(fn, 0, ...payload)

        // all other handlers should fail safe with @error
        try {
          fn.call({
            end,
            emit : (nextEvent, ...payload) => {
              if (ended) throw new PipelineError(`Can not emit "${nextEvent}" after pipeline closed`)
              if (nextEvent.startsWith('@')) throw new PipelineError('Event names starting with @ are reseved')
              if (transitions && (
                !transitions[event] || !transitions[event].has(nextEvent)
              )) throw new PipelineError(`Not allowed transition "${event}" → "${nextEvent}"`)

              setTimeout(() => ee.emit(nextEvent, trace(routes, nextEvent, payload), ...payload), 0)
            }
          }, ...payload)
        } catch (err) {
          setTimeout(end, 0, err)
        }
      })

      return this
    }

    this.start = start.bind(this)
    this.on = on.bind(this)
  }
}

module.exports = di()
if (process.env.NODE_ENV === 'test') module.exports.di = di
