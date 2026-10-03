// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs, TabBar } from '@/components/Tabs'

// Outside the App Router usePathname returns null; tests that need a path set it here.
const navigation = vi.hoisted(() => ({ usePathname: vi.fn((): string | null => null) }))
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

  it('with basePath, writes the selected tab to the URL path and drops the query', async () => {
    window.history.replaceState(null, '', '/my-writing/awards?commit=abc#top')
    render(<Tabs tabs={TABS} initialTab="awards" basePath="/my-writing" />)
    await userEvent.click(screen.getByRole('tab', { name: 'Books' }))
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/my-writing/books#top')
    // The first tab lives at the bare base path.
    await userEvent.click(screen.getByRole('tab', { name: 'Projects' }))
    expect(window.location.pathname).toBe('/my-writing')
  })

  it("with basePath, follows a link to another tab's path while the page stays mounted", async () => {
    const path = { value: '/my-writing' }
    navigation.usePathname.mockImplementation(() => path.value)
    const { rerender } = render(<Tabs tabs={TABS} initialTab="projects" basePath="/my-writing" />)
    await userEvent.click(screen.getByRole('tab', { name: 'Awards' }))
    path.value = '/my-writing/awards'
    rerender(<Tabs tabs={TABS} initialTab="projects" basePath="/my-writing" />)
    expect(screen.getByText('Awards panel')).toBeInTheDocument()

    // A link back to /my-writing: same initialTab from the server, so only the path moves.
    path.value = '/my-writing'
    rerender(<Tabs tabs={TABS} initialTab="projects" basePath="/my-writing" />)
    expect(screen.getByRole('tab', { name: 'Projects' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Projects panel')).toBeInTheDocument()
    navigation.usePathname.mockReset()
  })

  it('with pageTitle, sets the browser tab title the tab route would', async () => {
    window.history.replaceState(null, '', '/my-writing')
    render(<Tabs tabs={TABS} initialTab="projects" basePath="/my-writing" pageTitle={{ section: "My Writing" }} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Books' }))
    expect(document.title).toBe('Books · My Writing | Hedgie Hub')
    await userEvent.click(screen.getByRole('tab', { name: 'Projects' }))
    expect(document.title).toBe('My Writing | Hedgie Hub')
  })

  it('leaves the URL alone without basePath', async () => {
    window.history.replaceState(null, '', '/somewhere?x=1')
    render(<Tabs tabs={TABS} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Books' }))
    expect(`${window.location.pathname}${window.location.search}`).toBe('/somewhere?x=1')
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
