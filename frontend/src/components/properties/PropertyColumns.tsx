import { createContext, useContext, useEffect, useState, type DragEvent, type ReactNode } from "react"
import styles from "./PropertyColumns.module.css"

const STORAGE_KEY = "sitelytics.property-columns.v1"
const COLUMN_DEFINITIONS = [
  { id: "property", label: "Property", widthClass: "property-column-name", cellClass: "prop-name" },
  { id: "searchGraph", label: "Clicks / Impressions graph", widthClass: "property-column-search", cellClass: "sparkline-cell" },
  { id: "sessionsGraph", label: "Sessions graph", widthClass: "property-column-sessions", cellClass: "sparkline-cell" },
  { id: "impressions", label: "Impressions", widthClass: "property-column-metric", cellClass: "num-cell" },
  { id: "clicks", label: "Clicks", widthClass: "property-column-metric", cellClass: "num-cell" },
  { id: "ctr", label: "CTR", widthClass: "property-column-metric", cellClass: "num-cell" },
  { id: "position", label: "Position", widthClass: "property-column-metric", cellClass: "num-cell" },
  { id: "sessions", label: "Sessions", widthClass: "property-column-metric", cellClass: "num-cell ga-col" },
  { id: "ai", label: "AI mentions", widthClass: "property-column-metric", cellClass: "aeo-pie-cell" },
] as const

type ColumnId = typeof COLUMN_DEFINITIONS[number]["id"]
type ColumnPreference = { id: ColumnId; visible: boolean }
let defaultColumns = (): ColumnPreference[] => COLUMN_DEFINITIONS.map(({ id }) => ({ id, visible: true }))
let readColumns = (): ColumnPreference[] => {
  try {
    let saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")
    if (!Array.isArray(saved)) return defaultColumns()
    let columns: ColumnPreference[] = []
    for (let item of saved) {
      if (!item || !COLUMN_DEFINITIONS.some(column => column.id === item.id) || columns.some(column => column.id === item.id)) continue
      columns.push({ id: item.id, visible: item.id === "property" || item.visible !== false })
    }
    return [...columns, ...defaultColumns().filter(column => !columns.some(saved => saved.id === column.id))]
  } catch {
    return defaultColumns()
  }
}

let useColumnPreferences = () => {
  let [columns, setColumns] = useState(defaultColumns)
  let [loaded, setLoaded] = useState(false)
  useEffect(() => { setColumns(readColumns()); setLoaded(true) }, [])
  useEffect(() => {
    if (!loaded) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(columns)) } catch { /* Keep controls usable when storage is unavailable. */ }
  }, [columns, loaded])

  let moveColumn = (id: ColumnId, target: ColumnId) => setColumns(previous => {
    let next = [...previous]
    let from = next.findIndex(column => column.id === id)
    let to = next.findIndex(column => column.id === target)
    if (from < 0 || to < 0 || from === to) return previous
    next.splice(to, 0, ...next.splice(from, 1))
    return next
  })
  let toggleColumn = (id: ColumnId) => {
    if (id === "property") return
    setColumns(previous => previous.map(column => column.id === id ? { ...column, visible: !column.visible } : column))
  }
  let resetColumns = () => setColumns(defaultColumns())
  let orderedColumns = columns.map(column => ({ ...COLUMN_DEFINITIONS.find(definition => definition.id === column.id)!, visible: column.visible }))
  return { columns: orderedColumns, visibleColumns: orderedColumns.filter(column => column.visible), moveColumn, toggleColumn, resetColumns }
}

let ColumnContext = createContext<ReturnType<typeof useColumnPreferences> | null>(null)
export let PropertyColumnsProvider = ({ children }: { children: ReactNode }) => {
  let preferences = useColumnPreferences()
  return <ColumnContext.Provider value={preferences}>{children}</ColumnContext.Provider>
}
export let usePropertyColumns = () => {
  let context = useContext(ColumnContext)
  if (!context) throw new Error("Property columns require PropertyColumnsProvider")
  return context
}

export let PropertyColumnControls = () => {
  let { columns, resetColumns } = usePropertyColumns()
  let handleEscape = (event: React.KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key !== "Escape") return
    event.currentTarget.open = false
    event.currentTarget.querySelector("summary")?.focus()
  }
  return <details className={styles.controls} onKeyDown={handleEscape}>
    <summary className="toggle-btn">Columns</summary>
    <div className={styles.panel}>
      <p>Show columns and choose their order. You can also drag table headings.</p>
      <ul>{columns.map(column => <ColumnControl key={column.id} id={column.id} />)}</ul>
      <button type="button" className="toggle-btn" onClick={resetColumns}>Reset columns</button>
    </div>
  </details>
}

let ColumnControl = ({ id }: { id: ColumnId }) => {
  let { columns, moveColumn, toggleColumn } = usePropertyColumns()
  let index = columns.findIndex(column => column.id === id)
  let column = columns[index]
  let handleToggle = () => toggleColumn(id)
  let handleEarlier = () => { if (index > 0) moveColumn(id, columns[index - 1].id) }
  let handleLater = () => { if (index < columns.length - 1) moveColumn(id, columns[index + 1].id) }
  return <li className={styles.option}>
    <label><input type="checkbox" checked={column.visible} disabled={id === "property"} onChange={handleToggle} />{column.label}</label>
    <button type="button" onClick={handleEarlier} disabled={index === 0} aria-label={`Move ${column.label} left`} title="Move left">&larr;</button>
    <button type="button" onClick={handleLater} disabled={index === columns.length - 1} aria-label={`Move ${column.label} right`} title="Move right">&rarr;</button>
  </li>
}

export let PropertyColumnHeading = ({ id }: { id: ColumnId }) => {
  let { columns, moveColumn } = usePropertyColumns()
  let [isOver, setIsOver] = useState(false)
  let column = columns.find(column => column.id === id)!
  let handleDragStart = (event: DragEvent) => {
    event.dataTransfer.setData("application/x-sitelytics-column", id)
    event.dataTransfer.effectAllowed = "move"
  }
  let handleDragOver = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes("application/x-sitelytics-column")) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    setIsOver(true)
  }
  let handleDragLeave = () => setIsOver(false)
  let handleDrop = (event: DragEvent) => {
    event.preventDefault()
    setIsOver(false)
    let source = event.dataTransfer.getData("application/x-sitelytics-column")
    if (columns.some(column => column.id === source)) moveColumn(source as ColumnId, id)
  }
  return <th scope="col" draggable onDragStart={handleDragStart} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDragEnd={handleDragLeave} onDrop={handleDrop} className={`${styles.heading}${isOver ? ` ${styles.dragOver}` : ""}`} title="Drag to move column, or use the Columns menu">{column.label}</th>
}
