'use strict'

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

    // allow to be instantiated without `new`
    if (!(this instanceof AsyncPipeline)) return new AsyncPipeline(options)

    const {
      debug = noop,
      transitions = null,
      contextAPI = true
    } = options

    const knownEvents = new Set()
      .add('@error')
      .add('@end')

    if (transitions !== null) {
      // normalize transitions for lookups
      for (const from in transitions) {
        if (transitions.hasOwnProperty(from)) transitions[from] = new Set(transitions[from])
        knownEvents.add(from)
        for (const to of transitions[from]) knownEvents.add(to)
      }
    }

    const ee = new EventEmitter()
    const routes = []
    const handlers = {}
    const contextData = {}

    let ended = false
    let startedAt

    // private
    function end (err) {
      ended = true
      if (err) {
        if (!handlers['@error']) {
          console.error('\nPipeline crashed, listen to "@error" to prevent throwing\n')
          throw err
        }
        ee.emit('@error', null, err, routes.slice())
      }
      ee.emit('@end', null, routes.slice())
    }

    // private
    function trace(routes, event, payload = []) {
      const route = {event, payload, routes: [], time: timeSince(startedAt)}
      routes.push(route)
      return route.routes
    }

    // public, bound to instance
    function context(data = null) {
      if (data === null) return Object.assign({}, contextData)
      Object.assign(contextData, data)
      return this
    }

    // public, bound to instance
    function start(event, ...payload) {
      if (routes[0]) {
        throw new PipelineError('Pipeline has already started with ' +
          `"${routes[0].event}" (${JSON.stringify(routes[0].payload)})`)
      }

      if (transitions && !transitions[event]) throw new PipelineError(`Event "${event}" is not allowed entry point`)

      startedAt = process.hrtime();
      ee.emit(event, trace(routes, event, payload), ...payload)

      return this
    }

    // public, bound to instance
    function on (event, fn) {
      if (routes[0]) throw new PipelineError('Can not add handlers after pipeline started')
      if (transitions && !knownEvents.has(event)) throw new PipelineError(`Subscribing to event "${event}" not listed in transitions`)

      // track events being handled
      handlers[event] = (handlers[event] || 0) + 1

      ee.on(event, (routes, ...payload) => {
        const isInternal = event[0] === '@'
        debug('<', event, '>', payload)

        // internal event handlers should throw on error
        if (isInternal) {
          try {
            return contextAPI ? fn.call({context},...payload) : fn({context},...payload)
          } catch (err) {
            console.error(`\nPipeline crashed, error in "${event}" handler\n`)
            throw err
          }
        }

        // all other handlers should fail safly with @error
        try {
          const api = {
            end,
            context,
            emit  : (nextEvent, ...payload) => {
              if (ended && !isInternal) return debug(`✘ Pipeline closed, skipping ${event}`, ...payload)
              if (nextEvent.startsWith('@')) throw new PipelineError('Event names starting with @ are reseved')
              if (transitions && (
                !transitions[event] || !transitions[event].has(nextEvent)
              )) throw new PipelineError(`Not allowed transition "${event}" → "${nextEvent}"`)

              ee.emit(nextEvent, trace(routes, nextEvent, payload), ...payload)
            }
          }
          return contextAPI ? fn.call(api, ...payload) : fn(api, ...payload)
        } catch (err) {
          end(err)
        }
      })

      return this
    }

    // expose public API
    this.start = start.bind(this)
    this.on = on.bind(this)
    this.context = context.bind(this)
  }
}

module.exports = di()

if (process.env.NODE_ENV === 'test') {
  module.exports.di = di
  module.exports.PipelineError = PipelineError
}
