const {EventEmitter} = require('events')

const $ee = Symbol()
const $routes = Symbol()
const $ended = Symbol()
const $startedAt = Symbol()

const noop = () => {}

function timeSince(startedAt) {
  const [sec, nsec] = process.hrtime(startedAt)
  return parseInt(sec * 1e3 + nsec / 1e6)
}

function trace(startedAt, routes, event, payload = []) {
  const route = {event, payload, routes: [], time: timeSince(startedAt)}
  routes.push(route)
  return route.routes
}

class AsyncPipeline {
  constructor ({
    debug = noop,
    transitions = {}
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

    this.end = this.end.bind(this)
  }

  start(event, ...payload) {
    if (this[$routes][0]) {
      throw new Error('Pipeline has already started with ' +
        `${this[$routes][0].name} : ${JSON.stringify(this[$routes][0].payload)}`)
    }

    if (this.transitions && !this.transitions[event]) throw new Error(`Event ${event} is not allowed entry point`)

    this[$startedAt] = process.hrtime();
    this[$ee].emit(event, trace(this[$startedAt], this[$routes], event, payload), ...payload)
    return this
  }

  end (err) {
    this[$ended] = true
    if (err) this[$ee].emit('@error', null, err)
    this[$ee].emit('@end', null, this[$routes].slice())
  }

  on (event, fn) {
    if (this[$ended]) throw new Error('Can not add handlers after pipeline stopped')
    if (this[$routes][0]) throw new Error('Can not add handlers after pipeline started')

    this[$ee].on(event, (routes, ...payload) => {
      const isInternal = event[0] === '@'
      this.debug('◀︎', event, payload)

      // skip
      if (this[$ended] && !isInternal) return this.debug(`✘ skipping ${event}`, ...payload)

      // let @-events handles fail unsafe
      if (isInternal) return setTimeout(fn, 0, ...payload)

      // all other handlers should fail safe with @error
      try {
        fn.call({
          end  : this.end,
          emit : (nextEvent, ...payload) => {
            if (nextEvent.startsWith('@')) throw new Error('Event names starting with @ are reseved')
            if (this.transitions && !this.transitions[event].has(nextEvent)) throw new Error(`Not allowed to transition from "${event}" to "${nextEvent}"`)
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

new AsyncPipeline({
  transitions: {
    'start': ['stage-1:progress', 'stage-1:done'],
    'stage-1:done': ['stage-2:done']
  }
})
  .on('@error', console.error.bind(console, 'ERROR:'))
  .on('@end', function (dump) {
    console.log('END', require('util').inspect(dump, {colors: true, depth: 5}))
  })
  .on('start', function (count) {
    let i = 0
    while (i++ < count) setTimeout(this.emit, i * 100, 'stage-1:progress', i)
    setTimeout(this.emit, (count + 1) * 100, 'stage-1:done')
  })
  .on('stage-1:done', function () {
    setTimeout(this.emit, 200, 'stage-2:done', 'hello', 'there')
  })
  .on('stage-2:done', function(...args) {
    console.log('after stage-2', ...args)
    this.end()
    setTimeout(console.log, 500, 'ever finished?')
  })
  .on('stage-1:progress', console.log.bind(console, 'stage1'))
  .start('start', 5)
