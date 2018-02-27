const {test} = require('ava')
const {fork} = require('child_process');
const Pipeline = require('..')
const {di, PipelineError} = Pipeline

test('goes through stages passing payload', t => {
  const values = []
  return new Promise((resolve, reject) => {
    new Pipeline()
      .on('s0', function (i) {
        values.push(i)
        this.emit('s1', i + 1)
      }).on('s1', function (i) {
        values.push(i)
        this.emit('s2', i + 1)
      }).on('s2', function (i) {
        values.push(i)
        this.end()
      })
      .on('@end', resolve)
      .on('@error', reject)
      .start('s0', 0)
  }).then(() => {
    t.deepEqual(values, [0, 1, 2])
  })
})

test('provides cross-stages context', t => {
  return new Promise((resolve, reject) => {
    new Pipeline()
      .context({a: 1})
      .on('s0', function () {
        this.context({b: 2})
        this.emit('s1')
      }).on('s1', function () {
        this.context({c: 3})
        this.emit('s2')
      }).on('s2', function () {
        t.deepEqual(this.context(), {a:1, b:2, c:3})
        this.end()
      })
      .on('@end', resolve)
      .on('@error', reject)
      .start('s0', 0)
  })
})

test('context is available to internal event handlers', t => {
  return new Promise(resolve => {
    new Pipeline()
      .context({a: 1})
      .on('s0', () => { throw new Error('fail') })
      .on('@error', function() {
        this.context({b: 2})
      })
      .on('@end', function () {
        this.context({c: 3})
        t.deepEqual(this.context(), {a:1, b:2, c:3})
        resolve()
      })
      .start('s0', 0)
  })
})

test('throws on start if transition is not alowed', t => {
  const err = t.throws(() => {
    new Pipeline({
      transitions: {s0: ['s1']}
    }).start('s1')
  }, PipelineError)
  t.is(err.message, 'Event "s1" is not allowed entry point')
})

test('throws if transition is not allowed', t => {
  return new Promise(resolve => {
    new Pipeline({
      transitions: {s0: ['s1']}
    })
      .on('@error', err => {
        t.is(err.message, 'Not allowed transition "s0" → "s2"')
        resolve()
      })
      .on('s0', function () { this.emit('s2') })
      .start('s0')
  })
})

test('catchs exceptions with @error', t => {
  return new Promise(resolve => {
    new Pipeline({
      transitions: {s0: ['s1']}
    })
      .on('@error', err => {
        t.is(err.message, 'something unexpected')
        resolve()
      })
      .on('s0', () => { throw new Error('something unexpected') })
      .start('s0')
  })
})

test('throws to the top if no @error handler set', t => {
  return new Promise(resolve => {
    fork(require.resolve('./no-error-handler'), [], {silent: true})
      .on('message', message => {
        t.is(message, 'something unexpected')
        resolve()
      })
  })
})

test('emits @end after @error', t => {
  return new Promise(resolve => {
    new Pipeline()
      .on('@error', () => {}) // have something to prevent throwing
      .on('s0', function () { throw new Error('ooops') })
      .on('@end', () => {
        t.pass()
        resolve()
      })
      .start('s0')
  })
})

test('traces execution flow', t => {
  return new Promise(resolve => {
    const ImmediatePipeline = di({timeSince: () => 0})
    new ImmediatePipeline()
      .on('s0', function (i) {
        this.emit('s0:progress', 0.1)
        this.emit('s0:progress', 0.2)
        this.emit('s0:progress', 0.3)
        this.emit('s1', i + 1)
      })
      .on('s1', function (i) { this.emit('s2', i + 1) })
      .on('s2', function (i) { this.end() })
      .on('@end', trace => {
        t.deepEqual(trace, [{
          event   : 's0',
          payload : [0],
          time    : 0,
          routes  : [
            {event: 's0:progress', payload: [.1], time: 0, routes: []},
            {event: 's0:progress', payload: [.2], time: 0, routes: []},
            {event: 's0:progress', payload: [.3], time: 0, routes: []},
            {event: 's1',          payload: [1],  time: 0, routes: [
              {event: 's2', payload: [2], time: 0, routes: [
                {event: '@end', payload: [], time: 0, routes: []}
              ]}
            ]}
          ]
        }])
        resolve()
      })
      .start('s0', 0)
  })
})

test('traces execution when fails', t => {
  return new Promise(resolve => {
    const ImmediatePipeline = di({timeSince: () => 0})
    const failure = new Error('ooops')
    new ImmediatePipeline()
      .on('s0', function (i) {
        this.emit('s0:progress', 0.1)
        this.emit('s0:progress', 0.2)
        this.emit('s0:progress', 0.3)
        this.emit('s1', i + 1)
      })
      .on('s1', function (i) { this.emit('s2', i + 1) })
      .on('s2', function (i) { throw failure })
      .on('@error', (err, trace) => {
        t.deepEqual(trace, [{
          event   : 's0',
          payload : [0],
          time    : 0,
          routes  : [
            {event: 's0:progress', payload: [.1], time: 0, routes: []},
            {event: 's0:progress', payload: [.2], time: 0, routes: []},
            {event: 's0:progress', payload: [.3], time: 0, routes: []},
            {event: 's1',          payload: [1],  time: 0, routes: [
              {event: 's2', payload: [2], time: 0, routes: [
                {event: '@error', payload: [failure], time: 0, routes: []}
              ]}
            ]}
          ]
        }])
        resolve()
      })
      .start('s0', 0)
  })
})

test('does not allow to start more than once', t => {
  return new Promise(resolve => {
    const err = t.throws(() => {
      new Pipeline()
        .start('s0', {a: 0})
        .start('s0')
    }, PipelineError)
    t.is(err.message, 'Pipeline has already started with "s0" ([{"a":0}])')
    resolve()
  })
})

test('voids messages after emitting after end()', t => {
  return new Promise(resolve => {
    new Pipeline()
      .on('s0', function () {
        this.end()
        setTimeout(this.emit, 10, 's1')
      })
      .on('s1', () => t.fail('Should not be reached'))
      .on('@end', () => {
        t.pass()
        setTimeout(resolve, 50)
      })
      .start('s0')
  })
})

test('throws on emitting reserved events', t => {
  return new Promise(resolve => {
    new Pipeline()
      .on('s0', function () {
        this.emit('@whatever')
      })
      .on('@error', err => {
        t.true(err instanceof PipelineError)
        t.is(err.message, 'Event names starting with @ are reseved')
        resolve()
      })
      .start('s0')
  })
})

test('no on() calls after start', t => {
  const err = t.throws(() => {
    new Pipeline()
      .start('s0')
      .on('s0', () => {})
  })
  t.true(err instanceof PipelineError)
  t.is(err.message, 'Can not add handlers after pipeline started')
})

test('throws to the top if failed in @error handler', t => {
  return new Promise(resolve => {
    fork(require.resolve('./fail-in-@error'), [], {silent: true})
      .on('message', message => {
        t.is(message, 'failed in @error')
        resolve()
      })
  })
})

test('throws to the top if failed in @end handler', t => {
  return new Promise(resolve => {
    fork(require.resolve('./fail-in-@end'), [], {silent: true})
      .on('message', message => {
        t.is(message, 'failed in @end')
        resolve()
      })
  })
})

test('handlers with explicit call context', t => {
  return new Promise((resolve, reject) => {
    new Pipeline({contextAPI: false})
      .on('s0', function (api, ...args) {
        t.is(this, 42)
        t.deepEqual(args, [0])
        t.deepEqual(Object.keys(api), ['context', 'end', 'emit', 'safe'])
        api.emit('s1', 1)
      }.bind(42))
      .on('s1', (api, ...args) => {
        t.deepEqual(args, [1])
        api.end()
      })
      .on('@end', (api, ...args) => {
        t.is(args.length, 1)
        t.deepEqual(Object.keys(api), ['context'])
        resolve()
      })
      .on('@error', reject)
      .start('s0', 0)
  })
})

test('handlers with implicit call context', t => {
  return new Promise((resolve, reject) => {
    new Pipeline()
      .on('s0', function (...args) {
        t.deepEqual(args, [0])
        t.deepEqual(Object.keys(this), ['context', 'end', 'emit', 'safe'])
        this.emit('s1', 1)
      })
      .on('s1', function (...args) {
        t.deepEqual(args, [1])
        this.end()
      })
      .on('@end', function (...args) {
        t.is(args.length, 1) // [trace]
        t.deepEqual(Object.keys(this), ['context'])
        resolve()
      })
      .on('@error', reject)
      .start('s0', 0)
  })
})

test('errors with explicit call context', t => {
  const ImmediatePipeline = di({timeSince: () => 0})

  return new Promise(resolve => {
    const failure = new Error('ooops')
    new ImmediatePipeline({contextAPI: false})
      .on('s0', () => { throw failure })
      .on('@error', (api, ...args) => {
        t.deepEqual(Object.keys(api), ['context'])
        t.is(args.length, 2) // [err, trace]
        t.is(args[0].message, 'ooops')
        t.deepEqual(args[1], [{
          event   : 's0',
          payload : [0],
          time    : 0,
          routes  : [
            {event: '@error', payload: [failure], time: 0, routes: []}
          ]
        }])
        resolve()
      })
      .start('s0', 0)
  })
})

test('throws on unknown event subscription', t => {
  const err = t.throws(() => {
    new Pipeline({transitions: {s0: ['s1']}})
      .on('s2', () => {})
  })
  t.is(err.message, 'Subscribing to event "s2" not listed in transitions')
})

test('API methods are chainable with implicit context', t => {
  return new Promise(resolve => {
    new Pipeline()
      .on('s0', function () {
        t.is(this.emit('s1'), this);
      })
      .on('s1', function () {
        t.is(this.end(), this);
      })
      .on('@end', resolve)
      .start('s0');
  });
});

test('API methods are chainable with explicit context', t => {
  return new Promise(resolve => {
    new Pipeline({contextAPI: false})
      .on('s0', function (api) {
        t.is(api.emit('s1'), api);
      })
      .on('s1', function (api) {
        t.is(api.end(), api);
      })
      .on('@end', resolve)
      .start('s0');
  });
});

test('voids repeating end() calls', t => {
  let errCalls = 0
  let endCalls = 0

  return new Promise(resolve => {
    new Pipeline()
      .on('s0', function () {
        this.end(new Error('err1'))
        this.end(new Error('err2'))
        setTimeout(resolve, 10)
      })
      .on('@error', function () { errCalls++ })
      .on('@end', function () { endCalls++ })
      .start('s0')
  }).then(() => {
    t.is(errCalls, 1)
    t.is(endCalls, 1)
  })
})

test('voids repeating end() calls with explicit API', t => {
  let errCalls = 0
  let endCalls = 0

  return new Promise(resolve => {
    new Pipeline({contextAPI: false})
      .on('s0', pipeline => {
        pipeline.end(new Error('err1'))
        pipeline.end(new Error('err2'))
        setTimeout(resolve, 10)
      })
      .on('@error', pipeline => { errCalls++ })
      .on('@end', pipeline => { endCalls++ })
      .start('s0')
  }).then(() => {
    t.is(errCalls, 1)
    t.is(endCalls, 1)
  })
})

test('warns about emit() after end', t => {
  return new Promise(resolve => {
    new Pipeline({
      warn: (...args) => t.deepEqual(args, ['Skipping emit() call after pipeline ended:', 'a', 1])
    })
      .on('s0', function() {
        this.end()
        this.emit('a', 1)
      })
      .on('@end', resolve)
      .start('s0')
  })
})

test('warns about repeating end() call', t => {
  return new Promise(resolve => {
    new Pipeline({
      warn: (...args) => t.deepEqual(args, ['Skipping repeating end() call:', 'no error'])
    })
      .on('s0', function() {
        this.end()
        this.end()
        setTimeout(resolve, 10)
      })
      .start('s0')
  })
})

test('warns about repeating end() call with explicit API', t => {
  return new Promise(resolve => {
    new Pipeline({
      contextAPI: false,
      warn: (...args) => t.deepEqual(args, ['Skipping repeating end() call:', 'no error'])
    })
      .on('s0', pipeline => {
        pipeline.end()
        pipeline.end()
        setTimeout(resolve, 10)
      })
      .start('s0')
  })
})

test('warns about repeating end(err) call', t => {
  const err = new Error()
  return new Promise(resolve => {
    new Pipeline({
      warn: (...args) => t.deepEqual(args, ['Skipping repeating end() call:', err])
    })
      .on('s0', function() {
        this.end()
        this.end(err)
        setTimeout(resolve, 10)
      })
      .start('s0')
  })
})

test('warns about repeating end(err) call with explicit API', t => {
  const err = new Error()
  return new Promise(resolve => {
    new Pipeline({
      contextAPI: false,
      warn: (...args) => t.deepEqual(args, ['Skipping repeating end() call:', err])
    })
      .on('s0', pipeline => {
        pipeline.end()
        pipeline.end(err)
        setTimeout(resolve, 10)
      })
      .start('s0')
  })
})

test('catches errors by pipeline.safe()', t => {
  const theErr = new Error('failed')
  return new Promise(resolve => {
    new Pipeline()
      .on('s0', function() {
        setTimeout(this.safe(() => { throw theErr }), 1)
      })
      .on('@error', err => {
        t.is(err, theErr)
        resolve()
      })
      .start('s0')
  })
})

test('catches errors by pipeline.safe() with explicit API', t => {
  const theErr = new Error('failed')
  return new Promise(resolve => {
    new Pipeline({contextAPI: false})
      .on('s0', pipeline => {
        setTimeout(pipeline.safe(() => { throw theErr }), 1)
      })
      .on('@error', (pipeline, err) => {
        t.is(err, theErr)
        resolve()
      })
      .start('s0')
  })
})

test('uses debug() as fallback to warn()', t => {
  const theErr = new Error('failed')
  const err = new Error()
  return new Promise(resolve => {
    new Pipeline({
      debug: (subject, ...args) => {
        if (subject !== 'warning') return
        t.deepEqual(args, ['Skipping repeating end() call:', err])
      }
    })
      .on('s0', function() {
        this.end()
        this.end(err)
        setTimeout(resolve, 10)
      })
      .start('s0')
  })
})

test('catches all events via @all', t => {
  const calls = []
  return new Promise(resolve => {
    new Pipeline()
      .on('s0', function() { this.emit('s1', 1) })
      .on('s1', function() { this.end() })
      .on('@all', function(...args) { calls.push(args) })
      .on('@end', function(dump) {
        t.deepEqual(calls, [['s0', 0], ['s1', 1], ['@end', dump]])
        resolve()
      })
      .start('s0', 0)
    })
})

test('catches @error via @all', t => {
  const calls = []
  const error = new Error('failed')
  return new Promise(resolve => {
    new Pipeline()
      .on('s0', function() { throw error })
      .on('@all', function(...args) { calls.push(args) })
      .on('@error', () => {})
      .on('@end', function(dump) {
        t.deepEqual(calls, [['s0', 0], ['@error', error, dump], ['@end', dump]])
        resolve()
      })
      .start('s0', 0)
    })
})

test('catches all events via @all with explicit API', t => {
  const calls = []
  return new Promise(resolve => {
    new Pipeline({contextAPI: false})
      .on('s0', api => { api.emit('s1', 1) })
      .on('s1', api => { api.end() })
      .on('@all', (api, ...args) => { calls.push(args) })
      .on('@end', (api, dump) => {
        t.deepEqual(calls, [['s0', 0], ['s1', 1], ['@end', dump]])
        resolve()
      })
      .start('s0', 0)
    })
})

test('catches @error via @all with explicit API', t => {
  const calls = []
  const error = new Error('failed')
  return new Promise(resolve => {
    new Pipeline({contextAPI: false})
      .on('s0', api => { throw error })
      .on('@all', (api, ...args) => { calls.push(args) })
      .on('@error', () => {})
      .on('@end', (api, dump) => {
        t.deepEqual(calls, [['s0', 0], ['@error', error, dump], ['@end', dump]])
        resolve()
      })
      .start('s0', 0)
    })
})
