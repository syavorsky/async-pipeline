# async-pipeline

async-pipeline allows you to build a complex conditional flow from loosely coupled components.

[![Build Status](https://travis-ci.org/yavorskiy/async-pipeline.svg?branch=master)](https://travis-ci.org/yavorskiy/async-pipeline)

```
npm install async-pipeline
```

Imagine you have set of processing operations that might be applied in different order based on input and intermediate results.

![Processing graph](https://cdn.rawgit.com/yavorskiy/async-pipeline/04a50bbe/docs/graph.svg)

Of course you can build it as `Promise` chain(s) but it will look hard to read at least. And over time, after more additions, you have a good chance it to turn into unreadable code mess.

Another much easier approach would be to build the flow based on PubSub, and let processing functions listen and emit messages with payloads. This would let you split the flow into easily tested atomic stages doing one thing at a time, not coupled to other components. Plus, you can have multiple functions listening to the same events and build parallel secondary flows like logging and tracking aside from the main logic.

`async-pipeline` is helping to build such message hub by adding few generic features on top of `EventEmitter`:

- optionally apply transition constraint map
- catch errors and route them to one place
- track and log all transitions
- provide flow control events: `@end`, `@error`
- track execution time in milliseconds using `process.hrtime`

## Example

```js
new Pipeline({
  transitions: {
    'start': ['stage-1:progress', 'stage-1:done'],
    'stage-1:done': ['stage-2:done']
  }
})
  .on('@error', console.error.bind('ERROR:'))
  .on('@end', dump => {
    console.log('END:', inspect(dump, {depth: 10}))
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
  })
  .on('stage-1:progress', console.log.bind(console, 'stage1'))
  .start('start', 5)
```

the code would output following:

```
stage1 1
stage1 2
stage1 3
stage1 4
stage1 5
after stage-2 hello there
END: [ { event: 'start',
    payload: [ 5 ],
    routes:
     [ { event: 'stage-1:progress',
         payload: [ 1 ],
         routes: [],
         time: 107 },
       { event: 'stage-1:progress',
         payload: [ 2 ],
         routes: [],
         time: 200 },
       { event: 'stage-1:progress',
         payload: [ 3 ],
         routes: [],
         time: 305 },
       { event: 'stage-1:progress',
         payload: [ 4 ],
         routes: [],
         time: 402 },
       { event: 'stage-1:progress',
         payload: [ 5 ],
         routes: [],
         time: 503 },
       { event: 'stage-1:done',
         payload: [],
         routes:
          [ { event: 'stage-2:done',
              payload: [ 'hello', 'there' ],
              routes: [],
              time: 806 } ],
         time: 604 } ],
    time: 0 } ]
```

## API

Call `new Pipeline(options)` or just `Pipeline(options)` to get a pipeline instance. Where `options` are:

- `debug` - optional function to print internal logs, easiest way to get debugging output is to pass `{debug: console.log}`
- `contextAPI` – `true` by default, expose API controls to the handlers through `this`, otherwise pass as a first argument
- `transitions` - optional mapping defining allowed transitions and entry points. Example:

```js
{
  'from-event-0': ['to-event-1', 'to-event-2'],
  'from-event-2': ['to-event-3']
}
```

### Pipeline methods

- `this.start('event', ...payload)` - start the flow with event `event` and optional payload. This will throw if `options.constraints` is set and has no `event` key

- `this.context(dataObject)` - defines data object available to all handlers through `this.context()`

### Internal events and their payloads

- `@end (trace)` - fired once any handler calls `this.end()`. Also automatically triggered on unexpected errors
- `@error (error, trace)` - fired if any handler has thrown or explicitly called `this.end(error)`. This will cause an uncaught exception bubbling to the `process` level if no handler registered

### Handler context methods

Each handler except ones for internal events has access to following methods exposed though call context. Keep in mind that handlers should be defined as `function() {}`, arrow functions would forcefully override the context

- `this.end([error])` - end the flow and void all eventual events. If `error` passed that it's considered an emergency shutdown. In either case if will end up triggering `@end` event

- `this.emit('event', ...payload)` - cast an event with arbitrary payload. This will throw if emitted event is violating `options.constraints`

- `this.context([dataObject])` - getter/setter for context data kept shared for all handler. This should be used wisely though to keep handlers uncoupled

- `this.safe(fn)` - decorator for async calls that may throw within handler. Following would throw to the top level unless wrapped into `safe()`:  

```js
  pipeline.on('event', () => {
    const later = this.safe(() => { throw new Error() })
    setTimeout(later, 0)
  })
```

## Error handling

Errors thrown from within event handlers will be caught and routed as `@error` event payload. However those would bubble up to the top if no handler defined

Errors thrown from within internal events (`@end`, `@error`) are always bypassing `@error` and propagate to the top to avoid recursive failures. Same for the failures in `start()` and `on()` calls
