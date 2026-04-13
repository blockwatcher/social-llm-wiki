/**
 * Quartz component — EditButton
 *
 * Adds an "Edit" link to every wiki page that opens the page in the
 * local edit server (packages/edit-server).
 *
 * Installation:
 *   1. Copy this file to <your-quartz>/quartz/components/EditButton.tsx
 *   2. Export it in <your-quartz>/quartz/components/index.ts:
 *        export { default as EditButton } from "./EditButton"
 *   3. Add it to your layout in <your-quartz>/quartz.layout.ts:
 *        import { EditButton } from "./quartz/components"
 *        // then in defaultContentPageLayout or defaultListPageLayout:
 *        afterBody: [EditButton()],
 *
 * The edit server must be running: npm start --workspace=@social-llm-wiki/edit-server
 */

import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

interface EditButtonOptions {
  /** URL of the edit server. Default: http://localhost:7800 */
  editServerUrl?: string
}

const EditButton: QuartzComponent = ({
  fileData,
}: QuartzComponentProps) => {
  // fileData.filePath is the path relative to the content root
  const filePath = fileData.filePath
  if (!filePath) return null

  const editUrl = `http://localhost:7800/edit?file=${encodeURIComponent(filePath)}`

  return (
    <div class="edit-button-container">
      <a href={editUrl} class="edit-button" target="_blank" rel="noopener">
        ✎ Edit this page
      </a>
    </div>
  )
}

EditButton.css = `
.edit-button-container {
  margin-top: 2rem;
  padding-top: 1rem;
  border-top: 1px solid var(--lightgray);
}

.edit-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 0.82rem;
  color: var(--gray);
  border: 1px solid var(--lightgray);
  border-radius: 6px;
  text-decoration: none;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.edit-button:hover {
  color: var(--secondary);
  border-color: var(--secondary);
  background: var(--highlight);
}
`

export default (() => EditButton) satisfies QuartzComponentConstructor
