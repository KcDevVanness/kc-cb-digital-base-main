// TEMPORARY probe for `chore/ci-speed`: proves the fan-out gate goes red when the `checks` slice
// fails while `build` stays green. Removed by the follow-up commit; never merged.
describe('ci gate probe', () => {
  it('fails on purpose', () => {
    expect(1).toBe(2)
  })
})
