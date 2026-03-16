export let DayButton = ({ days, setDays, value }: { days: number; setDays: (d: number) => void; value: number }) => (
  <button
    className={`day-btn${days === value ? " day-btn-active" : ""}`}
    onClick={() => setDays(value)}
  >
    {value}d
  </button>
)
