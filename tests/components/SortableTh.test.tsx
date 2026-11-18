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

  it('is a real button: Tab reaches it, Enter and Space each sort once', async () => {
    const onClick = vi.fn()
    renderTh({ onClick })
    const user = userEvent.setup()
    await user.tab()
    const button = screen.getByRole('button', { name: /Name/ })
    expect(button).toHaveFocus()
    expect(button).toHaveAttribute('type', 'button')
    await user.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledTimes(1)
    await user.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('runs the handler once for a mouse click on the button, and once for one on the cell', async () => {
    const onClick = vi.fn()
    renderTh({ onClick })
    await userEvent.click(screen.getByRole('button', { name: /Name/ }))
    expect(onClick).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('columnheader'))
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('keeps the filter outside the button, so a filter box is not a button inside a button', () => {
    renderTh({ filter: <input placeholder="≤" /> })
    expect(screen.getByRole('button', { name: /Name/ })).not.toContainElement(screen.getByPlaceholderText('≤'))
  })

  it('exposes the sort state via aria-sort', () => {
    const { unmount } = renderTh({ active: true, direction: 'desc' })
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'descending')
    unmount()
    renderTh({ active: false })
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'none')
  })

  it('replaces the default cell classes when className is passed, keeping alignment', () => {
    renderTh({ className: 'pb-2 pr-2', align: 'right' })
    const th = screen.getByRole('columnheader')
    expect(th).toHaveClass('pb-2', 'pr-2', 'text-right', 'cursor-pointer')
    expect(th).not.toHaveClass('px-6')
  })

  it('renders filter slot content when passed', () => {
    renderTh({ filter: <input placeholder="≤" /> })
    expect(screen.getByPlaceholderText('≤')).toBeInTheDocument()
  })
})
