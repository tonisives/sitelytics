#[cfg(feature = "ssr")]
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    use axum::Router;
    use sitelytics::{app::App, shell};
    use leptos::prelude::*;
    use leptos_axum::{generate_route_list, LeptosRoutes};

    // ensure server functions are linked
    use leptos::server_fn::ServerFn;
    _ = sitelytics::app::Logout::url();
    _ = sitelytics::pages::dashboard::FetchGscData::url();
    _ = sitelytics::pages::detail::FetchPropertyDetail::url();
    _ = sitelytics::pages::detail::FetchDimension::url();
    _ = sitelytics::pages::detail::FetchGaSessions::url();

    let conf = get_configuration(None)?;
    let leptos_options = conf.leptos_options;
    let addr = leptos_options.site_addr;
    let routes = generate_route_list(App);

    let app = Router::new()
        .route(
            "/auth/google",
            axum::routing::get(sitelytics::api::server::auth_google),
        )
        .route(
            "/auth/callback",
            axum::routing::get(sitelytics::api::server::auth_callback),
        )
        .leptos_routes(&leptos_options, routes, {
            let leptos_options = leptos_options.clone();
            move || shell(leptos_options.clone())
        })
        .fallback(leptos_axum::file_and_error_handler(shell))
        .with_state(leptos_options);

    println!("listening on http://{}", &addr);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app.into_make_service()).await?;
    Ok(())
}

#[cfg(not(feature = "ssr"))]
pub fn main() {}
