pub mod dashboard;
pub mod detail;
pub mod login;

use leptos::prelude::*;

#[component]
pub fn DayButton(days: ReadSignal<u64>, set_days: WriteSignal<u64>, value: u64) -> impl IntoView {
    let active = move || days.get() == value;
    let handle_click = move |_| set_days.set(value);
    let label = format!("{value}d");

    view! {
        <button
            class:day-btn=true
            class:day-btn-active=active
            on:click=handle_click
        >
            {label}
        </button>
    }
}
