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
              {event: 's2', payload: [2], time: 0, routes: []}
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
    new ImmediatePipeline()
      .on('s0', function (i) {
        this.emit('s0:progress', 0.1)
        this.emit('s0:progress', 0.2)
        this.emit('s0:progress', 0.3)
        this.emit('s1', i + 1)
      })
      .on('s1', function (i) { this.emit('s2', i + 1) })
      .on('s2', function (i) { throw new Error('ooops') })
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
              {event: 's2', payload: [2], time: 0, routes: []}
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
