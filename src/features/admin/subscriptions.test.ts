import { describe, expect, it } from 'vitest'
import { allowedActions } from './SubscriptionsPage'
describe('subscription lifecycle actions', () => {
  it('offers the right actions per status', () => {
    expect(allowedActions('pending')).toEqual(['activate', 'cancel'])
    expect(allowedActions('active')).toContain('suspend')
    expect(allowedActions('suspended')).toContain('reactivate')
    expect(allowedActions('cancelled')).toEqual([])
  })
})
