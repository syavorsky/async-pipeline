const {EventEmitter} = require('events')

const $ee = Symbol()
const $routes = Symbol()
const $ended = Symbol()
const $startedAt = Symbol()
const $handlers = Symbol()

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

  function trace(startedAt, routes, event, payload = []) {
    const route = {event, payload, routes: [], time: timeSince(startedAt)}
    routes.push(route)
    return route.routes
  }

  return class AsyncPipeline {
    constructor ({
      debug = noop,
      transitions = null
    } = {}) {
      this.debug = debug

      this.transitions = null
      if (transitions) {
        this.transitions = {}
        for (const t in transitions) {
          if (transitions.hasOwnProperty(t)) this.transitions[t] = new Set(transitions[t])
        }
      }

      this[$ee] = new EventEmitter()
      this[$routes] = []
      this[$ended] = false
      this[$handlers] = {}

      this.end = this.end.bind(this)
    }

    start(event, ...payload) {
      if (this[$routes][0]) {
        throw new PipelineError('Pipeline has already started with ' +
          `${this[$routes][0].name} : ${JSON.stringify(this[$routes][0].payload)}`)
      }

      if (this.transitions && !this.transitions[event]) throw new PipelineError(`Event "${event}" is not allowed entry point`)

      this[$startedAt] = process.hrtime();
      this[$ee].emit(event, trace(this[$startedAt], this[$routes], event, payload), ...payload)
      return this
    }

    end (err) {
      this[$ended] = true
      if (err) {
        if (this[$handlers]['@error']) this[$ee].emit('@error', null, err)
        else  {
          console.error('\n☠︎ Pipeline crashed, listen to "@error" to prevent throwing\n')
          throw err
        }
      }
      this[$ee].emit('@end', null, this[$routes].slice())
    }

    on (event, fn) {
      if (this[$ended]) throw new PipelineError('Can not add handlers after pipeline closed')
      if (this[$routes][0]) throw new PipelineError('Can not add handlers after pipeline started')

      // track events being handled
      this[$handlers][event] = (this[$handlers][event] || 0) + 1

      this[$ee].on(event, (routes, ...payload) => {
        const isInternal = event[0] === '@'
        this.debug('◆', event, payload)

        // skip
        if (this[$ended] && !isInternal) return this.debug(`✘ Pipeline closed, skipping ${event}`, ...payload)

        // let @-events handles fail unsafe
        // if (isInternal) return setTimeout(fn, 0, ...payload)

        // all other handlers should fail safe with @error
        try {
          fn.call({
            end  : this.end,
            emit : (nextEvent, ...payload) => {
              if (this[$ended]) throw new PipelineError(`Can not emit "${nextEvent}" after pipeline closed`)
              if (nextEvent.startsWith('@')) throw new PipelineError('Event names starting with @ are reseved')
              if (this.transitions && (
                !this.transitions[event] || !this.transitions[event].has(nextEvent)
              )) throw new PipelineError(`Not allowed transition "${event}" → "${nextEvent}"`)

              setTimeout(() => this[$ee].emit(nextEvent, trace(this[$startedAt], routes, nextEvent, payload), ...payload), 0)
            }
          }, ...payload)
        } catch (err) {
          setTimeout(this.end, 0, err)
        }
      })

      return this
    }
  }
}

module.exports = di()
if (process.env.NODE_ENV === 'test') module.exports.di = di
