// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs, TabBar } from '@/components/Tabs'

// Outside the App Router useSearchParams returns null; tests that need the param set it here.
const navigation = vi.hoisted(() => ({ useSearchParams: vi.fn((): URLSearchParams | null => null) }))
vi.mock('next/navigation', () => navigation)

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

  it('with syncToUrl, writes the selected tab to the URL and drops the cleared params', async () => {
    window.history.replaceState(null, '', '/my-prickles?tab=projects&commit=abc&keep=1#top')
    render(<Tabs tabs={TABS} initialTab="projects" syncToUrl={{ param: 'tab', clear: ['commit'] }} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Books' }))
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/my-prickles?tab=books&keep=1#top'
    )
  })

  it('with syncToUrl, follows a link that changes ?tab= while the page stays mounted', async () => {
    const params = { value: new URLSearchParams('tab=projects') }
    navigation.useSearchParams.mockImplementation(() => params.value)
    const { rerender } = render(<Tabs tabs={TABS} initialTab="projects" syncToUrl={{ param: 'tab' }} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Awards' }))
    params.value = new URLSearchParams('tab=awards')
    rerender(<Tabs tabs={TABS} initialTab="projects" syncToUrl={{ param: 'tab' }} />)
    expect(screen.getByText('Awards panel')).toBeInTheDocument()

    // A link back to ?tab=projects: same initialTab from the server, so only the param moves.
    params.value = new URLSearchParams('tab=projects&commit=')
    rerender(<Tabs tabs={TABS} initialTab="projects" syncToUrl={{ param: 'tab' }} />)
    expect(screen.getByRole('tab', { name: 'Projects' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Projects panel')).toBeInTheDocument()
    navigation.useSearchParams.mockReset()
  })

  it('leaves the URL alone without syncToUrl', async () => {
    window.history.replaceState(null, '', '/somewhere?tab=projects')
    render(<Tabs tabs={TABS} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Books' }))
    expect(`${window.location.pathname}${window.location.search}`).toBe('/somewhere?tab=projects')
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
