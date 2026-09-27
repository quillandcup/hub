// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const push = vi.fn()
let search = ''
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/admin/things',
  useSearchParams: () => new URLSearchParams(search),
}))

import { SortableTh } from '@/components/SortableTh'
import { DataTablePager } from '@/components/DataTablePager'
import { useDataTable, useServerDataTable, type DataTable } from '@/lib/hooks/useDataTable'
import { AUTO_PAGINATE_THRESHOLD } from '@/lib/pagination'

interface Row {
  id: number
  name: string
  score: number
}
type Col = 'name' | 'score'

// Row i has name "Item 001".. and score that runs opposite to the index, so
// sorting by score reverses the list.
const makeRows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: i, name: `Item ${String(i).padStart(3, '0')}`, score: n - i }))
const getSortValue = (row: Row, col: Col) => (col === 'name' ? row.name : row.score)

function Table({ table }: { table: DataTable<Row, Col> }) {
  return (
    <>
      <table>
        <thead>
          <tr>
            <SortableTh label="Name" {...table.sortProps('name')} />
            <SortableTh label="Score" {...table.sortProps('score')} />
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <DataTablePager table={table} itemLabel="items" />
    </>
  )
}

function ClientHarness({ count, paginate }: { count: number; paginate?: 'auto' | false }) {
  const [minScore, setMinScore] = useState(0)
  const rows = makeRows(count).filter((r) => r.score > minScore)
  const table = useDataTable<Row, Col>({
    rows,
    getSortValue,
    defaultSort: { column: 'name', direction: 'asc' },
    paginate,
    resetKey: String(minScore),
  })
  return (
    <>
      <button onClick={() => setMinScore(10)}>Filter</button>
      <Table table={table} />
    </>
  )
}

const names = () => screen.getAllByRole('cell').map((c) => c.textContent)
const next = () => userEvent.click(screen.getByRole('button', { name: /next/i }))

describe('useDataTable (client mode)', () => {
  it(`shows every row and no pager at exactly ${AUTO_PAGINATE_THRESHOLD} rows`, () => {
    render(<ClientHarness count={AUTO_PAGINATE_THRESHOLD} />)
    expect(names()).toHaveLength(AUTO_PAGINATE_THRESHOLD)
    expect(screen.queryByRole('navigation', { name: /pagination/i })).toBeNull()
  })

  it(`auto-paginates at ${AUTO_PAGINATE_THRESHOLD + 1} rows`, async () => {
    render(<ClientHarness count={AUTO_PAGINATE_THRESHOLD + 1} />)
    expect(names()).toHaveLength(AUTO_PAGINATE_THRESHOLD)
    expect(screen.getByText(`Showing 1–50 of 51 items`)).toBeInTheDocument()
    await next()
    expect(names()).toEqual(['Item 050'])
  })

  it('never pages when paginate is false', () => {
    render(<ClientHarness count={120} paginate={false} />)
    expect(names()).toHaveLength(120)
    expect(screen.queryByRole('navigation', { name: /pagination/i })).toBeNull()
  })

  it('sorts across all pages, not just the visible one', async () => {
    render(<ClientHarness count={120} />)
    await next()
    await next()
    await userEvent.click(screen.getByText('Score')) // ascending score = last items first
    expect(names()[0]).toBe('Item 119')
  })

  it('returns to page 1 on a sort change', async () => {
    render(<ClientHarness count={120} />)
    await next()
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Score'))
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
  })

  it('returns to page 1 when the filter resetKey changes', async () => {
    render(<ClientHarness count={120} />)
    await next()
    await next()
    await userEvent.click(screen.getByRole('button', { name: 'Filter' })) // 110 rows left
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(names()[0]).toBe('Item 000')
  })

  it('changes page size and returns to page 1', async () => {
    render(<ClientHarness count={120} />)
    await next()
    await userEvent.selectOptions(screen.getByRole('combobox'), '100')
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    expect(names()).toHaveLength(100)
  })
})

function RevealHarness({ count, revealKey }: { count: number; revealKey: string | null }) {
  const table = useDataTable<Row, Col>({
    rows: makeRows(count),
    getSortValue,
    defaultSort: { column: 'name', direction: 'asc' },
    reveal: { key: revealKey, getRowKey: (r) => r.name },
  })
  return <Table table={table} />
}

describe('useDataTable reveal', () => {
  it('opens on the page containing the revealed row', () => {
    render(<RevealHarness count={120} revealKey="Item 070" />)
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    expect(screen.getByText('Item 070')).toBeInTheDocument()
  })

  it('keeps the revealed row on screen after a sort change', async () => {
    render(<RevealHarness count={120} revealKey="Item 070" />)
    await userEvent.click(screen.getByText('Score')) // ascending score reverses: Item 070 moves to index 49
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByText('Item 070')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Score')) // descending: back to index 70
    expect(screen.getByText('Item 070')).toBeInTheDocument()
  })

  it('keeps it on screen after a page-size change, but leaves manual paging alone', async () => {
    render(<RevealHarness count={120} revealKey="Item 010" />)
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    await next()
    expect(screen.queryByText('Item 010')).toBeNull()
    await userEvent.selectOptions(screen.getByRole('combobox'), '25')
    expect(screen.getByText('Page 1 of 5')).toBeInTheDocument()
    expect(screen.getByText('Item 010')).toBeInTheDocument()
  })

  it('falls back to page 1 when the key matches no row', () => {
    render(<RevealHarness count={120} revealKey="Nope" />)
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
  })
})

function ServerHarness({ rows, total, page = 1, pageSize = 50 }: { rows: Row[]; total: number; page?: number; pageSize?: number }) {
  const table = useServerDataTable<Row, Col>({
    rows,
    total,
    page,
    pageSize,
    allowed: ['name', 'score'],
    defaultSort: { column: 'name', direction: 'asc' },
  })
  return <Table table={table} />
}

describe('useServerDataTable (server mode)', () => {
  beforeEach(() => {
    push.mockClear()
    search = 'q=x&page=2'
  })

  it('renders the given page as-is and hides the pager when it all fits', () => {
    search = ''
    render(<ServerHarness rows={makeRows(3).reverse()} total={3} />)
    expect(names()).toEqual(['Item 002', 'Item 001', 'Item 000'])
    expect(screen.queryByRole('navigation', { name: /pagination/i })).toBeNull()
  })

  it('puts header clicks in the URL and returns to page 1', async () => {
    render(<ServerHarness rows={makeRows(50)} total={134} page={2} />)
    await userEvent.click(screen.getByText('Score'))
    expect(push).toHaveBeenCalledWith('/admin/things?q=x&sort=score&dir=asc')
  })

  it('pages and resizes via the URL', async () => {
    render(<ServerHarness rows={makeRows(50)} total={134} page={2} />)
    expect(screen.getByText('Showing 51–100 of 134 items')).toBeInTheDocument()
    await next()
    expect(push).toHaveBeenCalledWith('/admin/things?q=x&page=3')
    await userEvent.selectOptions(screen.getByRole('combobox'), '25')
    expect(push).toHaveBeenLastCalledWith('/admin/things?q=x&pageSize=25')
  })
})
