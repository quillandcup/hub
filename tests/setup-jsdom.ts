import { afterEach } from 'vitest'

// Only jsdom files render, so only they load Testing Library (react-dom is slow to import, and importing it in
// every one of the ~500 unit files was a large part of the suite's setup time). Node-environment files have
// nothing to clean up.
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
  const { cleanup } = await import('@testing-library/react')
  afterEach(() => {
    cleanup()
  })

  // The message box's editor (ProseMirror) measures the page to place the caret; jsdom has no layout, so it gets
  // zero-sized answers instead of a missing function.
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }
  Range.prototype.getBoundingClientRect = () => rect as DOMRect
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
  document.elementFromPoint = () => null
}
