// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReasonBadges, { type ReasonBadgeData } from '@/components/ReasonBadges'

describe('ReasonBadges', () => {
  it('renders nothing when there are no reasons', () => {
    const { container } = render(<ReasonBadges reasons={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one badge icon per reason, with the tooltip hidden until hovered', () => {
    const reasons: ReasonBadgeData[] = [
      { kind: 'hosting', tooltip: ["You're hosting this one"] },
      { kind: 'streak', tooltip: ['3-week streak here'] },
    ]
    render(<ReasonBadges reasons={reasons} />)
    expect(screen.getByText('🎤')).toBeInTheDocument()
    expect(screen.getByText('🔥')).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('renders the recommendation badges (experienced host, popular session, lots of regulars)', async () => {
    const user = userEvent.setup()
    const reasons: ReasonBadgeData[] = [
      { kind: 'experiencedHost', tooltip: ['Jane S has hosted 40 sessions'] },
      { kind: 'popular', tooltip: ['Usually about 9 writers'] },
      { kind: 'regulars', tooltip: ['Usually 5 regulars — Hedgies who come most weeks'] },
    ]
    render(<ReasonBadges reasons={reasons} />)
    expect(screen.getByRole('img', { name: /Popular session — Usually about 9 writers/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Lots of regulars/ })).toBeInTheDocument()

    await user.hover(screen.getByText('⭐'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Experienced host')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Jane S has hosted 40 sessions')
  })

  it('shows the tooltip content on hover and hides it again on mouse leave', async () => {
    const user = userEvent.setup()
    const reasons: ReasonBadgeData[] = [{ kind: 'streak', tooltip: ['5-week streak here'] }]
    render(<ReasonBadges reasons={reasons} />)

    const badge = screen.getByText('🔥')
    await user.hover(badge)
    expect(screen.getByRole('tooltip')).toHaveTextContent('5-week streak here')

    await user.unhover(badge)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('lists each sister and their attendance reason on separate lines', async () => {
    const user = userEvent.setup()
    const reasons: ReasonBadgeData[] = [
      {
        kind: 'sister',
        tooltip: [
          "Jane hasn't missed the last 2 · 4-week streak with you",
          'Sue came 1 of the last 2',
        ],
      },
    ]
    render(<ReasonBadges reasons={reasons} />)

    await user.hover(screen.getByText('🤝'))
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent("Jane hasn't missed the last 2 · 4-week streak with you")
    expect(tooltip).toHaveTextContent('Sue came 1 of the last 2')
  })
})
