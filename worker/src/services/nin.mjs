// Level 3 (brief §5.6): NIN verification through a licensed provider. Choosing the provider is
// BLOCKED(user), so only the interface and a fake exist. A provider returns whether the NIN was
// found and, if so, the names and date of birth on the record; the caller keeps none of it.
//
// interface: lookup(nin) -> { found: boolean, firstName?, middleName?, lastName?, dob?, reference }

export function fakeNinProvider(records = {}) {
  let n = 0;
  return {
    fake: true,
    async lookup(nin) {
      n++;
      const r = records[nin];
      return r ? { found: true, ...r, reference: `fake-nin-${n}` } : { found: false, reference: `fake-nin-${n}` };
    },
  };
}

export function unconfiguredNinProvider() {
  return {
    fake: false,
    async lookup() {
      const e = new Error('NIN verification is not available yet: no provider has been configured');
      e.status = 503;
      throw e;
    },
  };
}
