// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SortableTh } from '@/components/SortableTh'

function renderTh(props: Partial<ComponentProps<typeof SortableTh>> = {}) {
  return render(
    <table>
      <thead>
        <tr>
          <SortableTh
            label="Name"
            active={false}
            direction="asc"
            onClick={() => {}}
            {...props}
          />
        </tr>
      </thead>
    </table>
  )
}

describe('SortableTh', () => {
  it('renders the neutral icon when inactive', () => {
    renderTh({ active: false })
    expect(screen.getByText('↕')).toBeInTheDocument()
  })

  it('renders the ascending icon when active and asc', () => {
    renderTh({ active: true, direction: 'asc' })
    expect(screen.getByText('↑')).toBeInTheDocument()
  })

  it('renders the descending icon when active and desc', () => {
    renderTh({ active: true, direction: 'desc' })
    expect(screen.getByText('↓')).toBeInTheDocument()
  })

  it('calls onClick when the header is clicked', async () => {
    const onClick = vi.fn()
    renderTh({ onClick })
    await userEvent.click(screen.getByText('Name'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('renders filter slot content when passed', () => {
    renderTh({ filter: <input placeholder="≤" /> })
    expect(screen.getByPlaceholderText('≤')).toBeInTheDocument()
  })
})
