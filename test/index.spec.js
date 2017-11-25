const {test} = require('ava')
const {fork} = require('child_process');
const Pipeline = require('..')

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
  }, Error)
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
      .on('s0', function () { throw new Error('something unexpected') })
      .start('s0')
  })
})

test('throws to the top if no @error handler set', t => {
  return new Promise(resolve => {
    fork(require.resolve('./uncaught-error'), [], {silent: true})
      .on('message', message => {
        t.is(message, 'something unexpected')
        resolve()
      })
  })
})

test('emits @end after @error', t => {
  return new Promise(resolve => {
    new Pipeline()
      .on('@error', () => {})
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
    new (Pipeline.di({timeSince: () => 0}))()
      .on('s0', function (i) {
        this.emit('s0:progress', 0.1)
        this.emit('s0:progress', 0.2)
        this.emit('s0:progress', 0.3)
        this.emit('s1', i + 1)
      })
      .on('s1', function (i) { this.emit('s2', i + 1) })
      .on('s2', function (i) { this.end() })
      .on('@end', trace => {
        t.deepEqual(trace, [ { event: 's0',
          payload: [ 0 ],
          routes:
           [ { event: 's0:progress', payload: [ .1 ], routes: [], time: 0 },
             { event: 's0:progress', payload: [ .2 ], routes: [], time: 0 },
             { event: 's0:progress', payload: [ .3 ], routes: [], time: 0 },
             { event: 's1',
               payload: [ 1 ],
               routes: [ { event: 's2', payload: [ 2 ], routes: [], time: 0 } ],
               time: 0 } ],
          time: 0 } ])
        resolve()
      })
      .start('s0', 0)
  })
})
