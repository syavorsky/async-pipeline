const {EventEmitter} = require('events')

const $ee = Symbol()
const $routes = Symbol()
const $ended = Symbol()

const noop = () => {}

function trace(routes, event, payload = []) {
  const route = {event, payload, routes: []}
  routes.push(route)
  return route.routes
}

class AsyncPipeline {
  constructor ({debug = noop} = {}) {
    this.debug = debug
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

    this[$ee].emit(event, trace(this[$routes], event, payload), ...payload)
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
      if (this[$ended] && !isInternal) return console.log(`✘ skipping ${event}`, ...payload)

      // let @-events handles fail unsafe
      if (isInternal) return setTimeout(fn, 0, ...payload)

      // all other handlers should fail safe with @error
      try {
        fn.call({
          end  : this.end,
          emit : (event, ...payload) => {
            if (event.startsWith('@')) throw new Error('Event names starting with @ are reseved')
            setTimeout(() => this[$ee].emit(event, trace(routes, event, payload), ...payload), 0)
          }
        }, ...payload)
      } catch (err) {
        setTimeout(this.end, 0, err)
      }
    })

    return this
  }
}

new AsyncPipeline()
  .on('@error', console.error.bind(console, 'ERROR:'))
  .on('@end', function (dump) {
    console.log('END', dump)
    this.emit('test', 123)
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
