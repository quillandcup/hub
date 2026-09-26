// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs, TabBar } from '@/components/Tabs'

const TABS = [
  { id: 'projects', label: 'Projects', content: <p>Projects panel</p> },
  { id: 'books', label: 'Books', content: <p>Books panel</p> },
  { id: 'awards', label: 'Awards', content: <p>Awards panel</p> },
] as const

describe('Tabs', () => {
  it('shows the first tab by default and mounts only the active panel', () => {
    render(<Tabs tabs={TABS} />)
    expect(screen.getByRole('tab', { name: 'Projects' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Projects panel')).toBeInTheDocument()
    expect(screen.queryByText('Books panel')).not.toBeInTheDocument()
  })

  it('honors initialTab', () => {
    render(<Tabs tabs={TABS} initialTab="awards" />)
    expect(screen.getByRole('tab', { name: 'Awards' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Awards panel')).toBeInTheDocument()
  })

  it('switches panels on click', async () => {
    render(<Tabs tabs={TABS} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Books' }))
    expect(screen.getByRole('tab', { name: 'Books' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Projects' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('Books panel')).toBeInTheDocument()
    expect(screen.queryByText('Projects panel')).not.toBeInTheDocument()
  })

  it('falls back to the first tab when initialTab is not among the tabs', () => {
    render(<Tabs tabs={TABS.slice(0, 2)} initialTab={'awards' as 'projects'} />)
    expect(screen.getByText('Projects panel')).toBeInTheDocument()
  })
})

describe('TabBar', () => {
  it('reports clicks without changing selection itself', async () => {
    const onTabChange = vi.fn()
    render(<TabBar tabs={TABS} activeTab="projects" onTabChange={onTabChange} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Awards' }))
    expect(onTabChange).toHaveBeenCalledWith('awards')
    expect(screen.getByRole('tab', { name: 'Projects' })).toHaveAttribute('aria-selected', 'true')
  })
})
