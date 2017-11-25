
const Pipeline = require('..')

process.once('uncaughtException', err => {
  process.send(err.message)
  process.exit(0)
})

new Pipeline({
  transitions: {s0: ['s1']}
})
  .on('s0', () => { throw new Error('something unexpected') })
  .start('s0')
