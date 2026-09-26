// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PillFilter } from '@/components/PillFilter'

const OPTIONS = [
  { id: 'all', label: 'All', count: 5 },
  { id: 'retreats', label: 'Retreats', count: 2 },
  { id: 'other', label: 'Other' },
] as const
type Id = (typeof OPTIONS)[number]['id']

function Controlled({ variant }: { variant?: 'pill' | 'segmented' }) {
  const [value, setValue] = useState<Id>('all')
  return (
    <>
      <PillFilter ariaLabel="Type" options={OPTIONS} value={value} onChange={setValue} variant={variant} />
      <p>selected: {value}</p>
    </>
  )
}

describe('PillFilter', () => {
  it('renders a labelled group with the active option pressed', () => {
    render(<PillFilter ariaLabel="Type" options={OPTIONS} value="retreats" onChange={() => {}} />)
    expect(screen.getByRole('group', { name: 'Type' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retreats/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /All/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows count badges when provided', () => {
    render(<PillFilter ariaLabel="Type" options={OPTIONS} value="all" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /Retreats/ })).toHaveTextContent('Retreats2')
    expect(screen.getByRole('button', { name: /Other/ })).toHaveTextContent(/^Other$/)
  })

  it('calls onChange with the option id', async () => {
    const onChange = vi.fn()
    render(<PillFilter ariaLabel="Type" options={OPTIONS} value="all" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Other/ }))
    expect(onChange).toHaveBeenCalledWith('other')
  })

  it.each(['pill', 'segmented'] as const)('updates selection when controlled (%s)', async (variant) => {
    render(<Controlled variant={variant} />)
    await userEvent.click(screen.getByRole('button', { name: /Retreats/ }))
    expect(screen.getByText('selected: retreats')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retreats/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /All/ })).toHaveAttribute('aria-pressed', 'false')
  })
})
