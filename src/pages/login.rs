use leptos::prelude::*;

#[component]
pub fn LoginPage() -> impl IntoView {
    view! {
        <div class="login-page">
            <div class="login-box">
                <h1>"Sitelytics"</h1>
                <p class="login-subtitle">"Google Search Console and Analytics in one view"</p>
                <a href="/auth/google" rel="external" class="google-btn">"Sign in with Google"</a>
            </div>
        </div>
    }
}
