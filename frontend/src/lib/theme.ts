export let getTheme = (): "light" | "dark" => {
  let stored = localStorage.getItem("sl-theme")
  if (stored === "light" || stored === "dark") return stored
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export let setTheme = (theme: "light" | "dark") => {
  localStorage.setItem("sl-theme", theme)
  document.documentElement.setAttribute("data-theme", theme)
}

export let toggleTheme = () => {
  let current = getTheme()
  setTheme(current === "dark" ? "light" : "dark")
}
