import { describe, expect, it, vi } from 'vitest'
import type Mux from '@mux/mux-node'
import { signThumbnailTokens } from '@/lib/mux'

describe('signThumbnailTokens', () => {
  const fakeMux = () => {
    const signPlaybackId = vi.fn(async (_id: string, config: { params: { time: string } }) => `token-at-${config.params.time}`)
    return { mux: { jwt: { signPlaybackId } } as unknown as Mux, signPlaybackId }
  }

  it('signs one thumbnail token per moment, with the time and width inside the claims, in order', async () => {
    const { mux, signPlaybackId } = fakeMux()
    const tokens = await signThumbnailTokens(mux, 'pb-1', [0, 12.34, 600])

    expect(tokens).toEqual(['token-at-0', 'token-at-12.3', 'token-at-600'])
    expect(signPlaybackId).toHaveBeenCalledTimes(3)
    expect(signPlaybackId).toHaveBeenNthCalledWith(2, 'pb-1', { type: 'thumbnail', expiration: '1h', params: { time: '12.3', width: '640' } })
  })

  it('takes a width and an expiry', async () => {
    const { mux, signPlaybackId } = fakeMux()
    await signThumbnailTokens(mux, 'pb-1', [5], { width: 320, expiration: '10m' })
    expect(signPlaybackId).toHaveBeenCalledWith('pb-1', { type: 'thumbnail', expiration: '10m', params: { time: '5', width: '320' } })
  })

  it('signs nothing for no moments', async () => {
    const { mux, signPlaybackId } = fakeMux()
    expect(await signThumbnailTokens(mux, 'pb-1', [])).toEqual([])
    expect(signPlaybackId).not.toHaveBeenCalled()
  })
})
