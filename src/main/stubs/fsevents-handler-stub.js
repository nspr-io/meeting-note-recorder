'use strict';

class FsEventsHandlerStub {
  constructor() {
    // eslint-disable-next-line no-console
    console.warn('[FSEVENTS-HANDLER-STUB] Attempted to instantiate stub handler');
    throw new Error('FsEventsHandler stub should not be instantiated');
  }
}

module.exports = FsEventsHandlerStub;
module.exports.canUse = () => {
  // eslint-disable-next-line no-console
  console.warn('[FSEVENTS-HANDLER-STUB] canUse invoked; returning false');
  return false;
};
