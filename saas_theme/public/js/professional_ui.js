/*
 * SaaS Theme — Professional UI Refresh
 *
 * Adds a native-data workspace home to Frappe v16's Apps desktop screen.
 * No Frappe core templates are replaced and no server-side data is invented:
 * only workspaces already present in frappe.boot are rendered.
 */
(function () {
	"use strict";

	if (typeof frappe === "undefined") return;

	frappe.provide("saas_theme.professional_ui");

	const RECENT_KEY = "saas_theme_recent_workspaces_v1";
	const MAX_RECENT = 6;

	function escape_html(value) {
		const text = value == null ? "" : String(value);
		return frappe.utils?.escape_html ? frappe.utils.escape_html(text) : $("<div>").text(text).html();
	}

	function slug(value) {
		const text = value == null ? "" : String(value);
		if (frappe.router?.slug) return frappe.router.slug(text);
		return text
			.trim()
			.toLowerCase()
			.replace(/&/g, " and ")
			.replace(/\s+/g, "-")
			.replace(/[^a-z0-9_-]/g, "");
	}

	function icon_html(icon_name, fallback = "layout-grid") {
		let icon = icon_name || fallback;
		if (typeof icon === "string" && icon.trim().startsWith("<")) return icon;
		try {
			return frappe.utils.icon(icon, "md");
		} catch (e) {
			try {
				return frappe.utils.icon(fallback, "md");
			} catch (ignored) {
				return "";
			}
		}
	}

	function is_private_workspace(workspace) {
		return workspace?.public === 0 || workspace?.public === false || workspace?.is_private === 1;
	}

	function find_workspace_page(name) {
		const pages = frappe.boot?.workspaces?.pages || [];
		return pages.find((page) => page.name === name || page.title === name);
	}

	function sidebar_for_module(module_name) {
		if (!module_name) return null;

		if (typeof frappe.utils?.sidebar_for_module === "function") {
			const sidebar = frappe.utils.sidebar_for_module(module_name);
			if (sidebar) return sidebar;
		}

		const sidebars = frappe.boot?.module_sidebars || {};
		if (sidebars[module_name]) {
			return { name: module_name, ...sidebars[module_name] };
		}

		for (const [name, sidebar] of Object.entries(sidebars)) {
			if (sidebar?.module === module_name || sidebar?.label === module_name) {
				return { name, ...sidebar };
			}
		}

		return null;
	}

	function workspace_route(workspace, shell_hint = null) {
		if (workspace?.route && String(workspace.route).startsWith("/")) return workspace.route;

		const workspace_name = workspace?.name || workspace?.title || workspace?.label;
		if (!workspace_name) return "/desk";

		const module_name = workspace?.module || workspace?.module_name || workspace?.app || "";
		const sidebar = shell_hint || sidebar_for_module(module_name);
		const shell = sidebar?.name || sidebar?.title || sidebar?.module || module_name || null;

		if (frappe.ui?.sidebar_item?.get_route) {
			const item = {
				type: "Link",
				link_type: "Workspace",
				link_to: workspace_name,
				route: workspace.route || undefined,
			};
			try {
				const resolved = frappe.ui.sidebar_item.get_route(item, false, shell);
				if (resolved) return resolved;
			} catch (e) {
				// Older v16 builds may not initialize frappe.workspaces on the Apps screen.
				// Fall through to the version-compatible route builder below.
			}
		}

		const legacy_app_prefix = window.location.pathname.startsWith("/app") ? "/app" : "/desk";
		if (legacy_app_prefix === "/app") {
			return `${legacy_app_prefix}/${slug(workspace_name)}`;
		}

		if (is_private_workspace(workspace)) {
			return `/desk/private/${slug(workspace.title || workspace_name)}`;
		}

		const workspace_slug = slug(workspace_name);
		const shell_slug = shell ? slug(shell) : "";
		if (shell_slug && shell_slug !== workspace_slug) {
			return `/desk/${shell_slug}/${workspace_slug}`;
		}
		return `/desk/${workspace_slug}`;
	}

	function nested_items(items) {
		const output = [];
		(items || []).forEach((item) => {
			if (!item) return;
			output.push(item);
			if (Array.isArray(item.nested_items)) output.push(...nested_items(item.nested_items));
			if (Array.isArray(item.items)) output.push(...nested_items(item.items));
		});
		return output;
	}

	function workspace_icon(workspace) {
		if (workspace.icon) return workspace.icon;

		const module_name = workspace.module || workspace.module_name;
		if (module_name && typeof frappe.get_module_icon === "function") {
			const module_icon = frappe.get_module_icon(module_name);
			if (module_icon) return module_icon;
		}

		const sidebar = sidebar_for_module(module_name);
		return sidebar?.header_icon || "layout-grid";
	}

	function workspace_description(workspace) {
		const module_name = workspace.module || workspace.module_name || workspace.app;
		if (workspace.description) return workspace.description;
		if (module_name) {
			return __("Open {0} tools, reports and daily transactions.", [__(module_name)]);
		}
		return __("Open tools, reports and daily transactions in this workspace.");
	}

	function normalize_workspace(workspace, shell_hint = null) {
		const name = workspace.name || workspace.title || workspace.label || workspace.link_to;
		const title = workspace.title || workspace.label || workspace.link_to || workspace.name;
		const module_name =
			workspace.module ||
			workspace.module_name ||
			shell_hint?.module ||
			shell_hint?.label ||
			shell_hint?.name ||
			__("General");

		return {
			name,
			title,
			module: module_name,
			public: workspace.public,
			is_private: workspace.is_private,
			icon: workspace.icon || shell_hint?.header_icon || workspace_icon(workspace),
			description: workspace_description({ ...workspace, module: module_name }),
			route: workspace_route({ ...workspace, name, title, module: module_name }, shell_hint),
		};
	}

	function from_boot_workspace_pages() {
		const pages = frappe.boot?.workspaces?.pages || [];
		const can_manage_workspaces = !!frappe.boot?.workspaces?.has_access;

		return pages
			.filter((workspace) => {
				if (!workspace || !workspace.name) return false;
				// Frappe intentionally keeps hidden pages in a Workspace Manager's boot payload so
				// they remain discoverable/manageable. Preserve that native permission behavior.
				if (!can_manage_workspaces && (workspace.hidden === 1 || workspace.is_hidden === 1)) {
					return false;
				}
				return workspace.hide_custom !== 1;
			})
			.map((workspace) => normalize_workspace(workspace));
	}

	function from_module_sidebars() {
		const sidebars = frappe.boot?.module_sidebars || {};
		const output = [];

		for (const [shell_name, raw_sidebar] of Object.entries(sidebars)) {
			const sidebar = { name: shell_name, ...(raw_sidebar || {}) };
			const links = nested_items(sidebar.items).filter(
				(item) => item.type === "Link" && item.link_type === "Workspace" && item.link_to
			);

			links.forEach((item) => {
				const page = find_workspace_page(item.link_to) || {};
				output.push(
					normalize_workspace(
						{
							...page,
							name: page.name || item.link_to,
							title: page.title || item.label || item.link_to,
							icon: page.icon || item.icon,
							module: page.module || sidebar.module || shell_name,
							route: (() => {
								if (!frappe.ui?.sidebar_item?.get_route) return item.route;
								try {
									return frappe.ui.sidebar_item.get_route(item, false, shell_name) || item.route;
								} catch (e) {
									return item.route;
								}
							})(),
						},
						sidebar
					)
				);
			});
		}

		return output;
	}

	function from_legacy_sidebars() {
		const sidebars = frappe.boot?.workspace_sidebar_item || {};
		const output = [];

		for (const [key, raw_sidebar] of Object.entries(sidebars)) {
			const sidebar = { name: raw_sidebar?.name || raw_sidebar?.label || key, ...(raw_sidebar || {}) };
			const links = nested_items(sidebar.items || sidebar.sidebar_items || []).filter(
				(item) => item.link_type === "Workspace" && item.link_to
			);

			links.forEach((item) => {
				const page = find_workspace_page(item.link_to) || {};
				output.push(
					normalize_workspace(
						{
							...page,
							name: page.name || item.link_to,
							title: page.title || item.label || item.link_to,
							icon: page.icon || item.icon,
							module: page.module || sidebar.module || sidebar.label || sidebar.name,
						},
						sidebar
					)
				);
			});
		}

		return output;
	}

	function fallback_sidebar_landings() {
		const output = [];

		const modern = frappe.boot?.module_sidebars || {};
		for (const [shell_name, raw_sidebar] of Object.entries(modern)) {
			const sidebar = { name: shell_name, ...(raw_sidebar || {}) };
			let route = null;
			if (frappe.app?.sidebar?.module_landing_route) {
				route = frappe.app.sidebar.module_landing_route(shell_name);
			}
			output.push({
				name: shell_name,
				title: sidebar.label || sidebar.title || shell_name,
				module: sidebar.app || sidebar.module || __("Workspace"),
				icon: sidebar.header_icon || "layout-grid",
				description: __("Open the {0} workspace and its navigation.", [__(sidebar.label || shell_name)]),
				route: route || `/desk/${slug(shell_name)}`,
			});
		}

		if (output.length) return output;

		const legacy = frappe.boot?.desktop_icons || [];
		return legacy
			.filter((icon) => icon.hidden !== 1 && icon.link_type === "Workspace Sidebar")
			.map((icon) => {
				const legacy_sidebar =
					frappe.boot?.workspace_sidebar_item?.[String(icon.label || "").toLowerCase()] || {};
				return {
					name: icon.label,
					title: icon.label,
					module: icon.module || __("Workspace"),
					icon: legacy_sidebar.header_icon || icon.icon || "layout-grid",
					description: __("Open the {0} workspace and its navigation.", [__(icon.label)]),
					route: `/app/${slug(icon.label)}`,
				};
			});
	}

	function unique_workspaces(workspaces) {
		const seen = new Set();
		return workspaces.filter((workspace) => {
			if (!workspace?.name || !workspace?.route) return false;
			const key = `${workspace.name}::${workspace.route}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	function get_workspaces() {
		let workspaces = from_boot_workspace_pages();

		// If pages have no useful module placement, the resolved sidebars are a better
		// representation of what the current user can really navigate to.
		if (!workspaces.length) workspaces = from_module_sidebars();
		if (!workspaces.length) workspaces = from_legacy_sidebars();
		if (!workspaces.length) workspaces = fallback_sidebar_landings();

		return unique_workspaces(workspaces).sort((a, b) =>
			String(a.title).localeCompare(String(b.title), undefined, { sensitivity: "base" })
		);
	}

	function get_recent() {
		try {
			const recent = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
			return Array.isArray(recent) ? recent : [];
		} catch (e) {
			return [];
		}
	}

	function save_recent(workspace) {
		try {
			const next = get_recent().filter((item) => item.name !== workspace.name);
			next.unshift({
				name: workspace.name,
				title: workspace.title,
				module: workspace.module,
				icon: workspace.icon,
				route: workspace.route,
			});
			localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, MAX_RECENT)));
		} catch (e) {
			// localStorage can be unavailable in hardened browser contexts; navigation still works.
		}
	}

	function arrow_icon() {
		return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
			stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path>
		</svg>`;
	}

	function search_icon() {
		return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
			stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path>
		</svg>`;
	}

	function lock_icon() {
		return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
			stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<rect width="18" height="11" x="3" y="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
		</svg>`;
	}

	function workspace_card(workspace) {
		const private_label = is_private_workspace(workspace)
			? `<span class="st-workspace-private">${lock_icon()}${__("Private")}</span>`
			: "";

		const search_value = escape_html(
			`${workspace.title || ""} ${workspace.module || ""}`.toLowerCase()
		);

		return `
			<a class="st-workspace-card"
				href="${escape_html(workspace.route)}"
				data-workspace-name="${escape_html(workspace.name)}"
				data-module="${escape_html(workspace.module || "")}"
				data-search="${search_value}">
				<div class="st-workspace-card-top">
					<div class="st-workspace-card-icon">${icon_html(workspace.icon)}</div>
					<span class="st-workspace-card-arrow">${arrow_icon()}</span>
				</div>
				<div class="st-workspace-card-title" title="${escape_html(workspace.title)}">
					${escape_html(__(workspace.title))}
				</div>
				<div class="st-workspace-card-description">
					${escape_html(workspace.description)}
				</div>
				<div class="st-workspace-card-footer">
					<span class="st-workspace-module">${escape_html(__(workspace.module || __("General")))}</span>
					${private_label}
				</div>
			</a>`;
	}

	function recent_html(workspaces) {
		const by_name = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
		const items = get_recent()
			.map((item) => by_name.get(item.name) || item)
			.filter((item) => item?.route)
			.slice(0, MAX_RECENT);

		if (!items.length) return "";

		return `
			<section class="st-workspace-section st-workspace-recent-section">
				<div class="st-workspace-section-head">
					<h2 class="st-workspace-section-title">${__("Recent")}</h2>
					<span class="st-workspace-section-count">${__("Your recently opened workspaces")}</span>
				</div>
				<div class="st-workspace-recent">
					${items
						.map(
							(item) => `
								<a class="st-workspace-recent-item" href="${escape_html(item.route)}"
									data-workspace-name="${escape_html(item.name)}">
									<span class="st-workspace-recent-icon">${icon_html(item.icon)}</span>
									<span class="st-workspace-recent-copy">
										<span class="st-workspace-recent-title">${escape_html(__(item.title || item.name))}</span>
										<span class="st-workspace-recent-module">${escape_html(__(item.module || __("Workspace")))}</span>
									</span>
								</a>`
						)
						.join("")}
				</div>
			</section>`;
	}

	function render_workspace_home(desktop) {
		if (frappe.boot?.desktop_page === "Desktop Icons") return;

		const $wrapper = $(".desktop-wrapper").last();
		const $container = $wrapper.find(".desktop-container").first();
		if (!$container.length) return;

		const workspaces = get_workspaces();
		if (!workspaces.length) return;

		// DesktopPage.make() recreates this container every time the route is shown,
		// so replacing the native Apps grid here is deterministic and does not patch core.
		$container.find(".icons-container").remove();
		$container.find(".st-workspace-home").remove();
		$container.addClass("st-workspace-home-active");

		const modules = [...new Set(workspaces.map((workspace) => workspace.module).filter(Boolean))].sort(
			(a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "base" })
		);

		const chips = [
			`<button class="st-workspace-chip active" type="button" data-module="all">${__("All")}</button>`,
			...modules.map(
				(module) =>
					`<button class="st-workspace-chip" type="button" data-module="${escape_html(module)}">${escape_html(
						__(module)
					)}</button>`
			),
		].join("");

		const $home = $(`
			<div class="st-workspace-home">
				<header class="st-workspace-home-header">
					<div class="st-workspace-home-copy">
						<h1 class="st-workspace-home-title">${__("Workspaces")}</h1>
						<p class="st-workspace-home-subtitle">
							${__("Open the workspace you need and continue directly to its tools, reports and transactions.")}
						</p>
					</div>
					<div class="st-workspace-home-meta">
						<span>${workspaces.length}</span>
						<span>${workspaces.length === 1 ? __("workspace") : __("workspaces")}</span>
					</div>
				</header>

				${recent_html(workspaces)}

				<section class="st-workspace-section st-workspace-all-section">
					<div class="st-workspace-section-head">
						<h2 class="st-workspace-section-title">${__("All Workspaces")}</h2>
						<span class="st-workspace-section-count st-workspace-visible-count">${workspaces.length}</span>
					</div>

					<div class="st-workspace-toolbar">
						<label class="st-workspace-search">
							<span class="st-workspace-search-icon">${search_icon()}</span>
							<input type="search" autocomplete="off" spellcheck="false"
								placeholder="${escape_html(__("Search workspaces..."))}">
						</label>
					</div>

					<div class="st-workspace-filter-chips">${chips}</div>

					<div class="st-workspace-grid">
						${workspaces.map(workspace_card).join("")}
					</div>

					<div class="st-workspace-empty">
						<div class="st-workspace-empty-icon">${icon_html("search")}</div>
						<div>${__("No workspaces match your search.")}</div>
					</div>
				</section>
			</div>
		`);

		$container.append($home);

		let active_module = "all";
		const $search = $home.find(".st-workspace-search input");
		const $cards = $home.find(".st-workspace-card");
		const $empty = $home.find(".st-workspace-empty");
		const $count = $home.find(".st-workspace-visible-count");

		const apply_filters = () => {
			const query = String($search.val() || "").trim().toLowerCase();
			let visible = 0;

			$cards.each(function () {
				const $card = $(this);
				const module_name = String($card.data("module") || "");
				const searchable = String($card.attr("data-search") || "");
				const module_match = active_module === "all" || module_name === active_module;
				const query_match = !query || searchable.includes(query);
				const show = module_match && query_match;
				$card.toggle(show);
				if (show) visible++;
			});

			$count.text(visible);
			$empty.toggleClass("visible", visible === 0);
		};

		$search.on("input", apply_filters);

		$home.find(".st-workspace-chip").on("click", function () {
			active_module = String($(this).data("module") || "all");
			$home.find(".st-workspace-chip").removeClass("active");
			$(this).addClass("active");
			apply_filters();
		});

		$home.on("click", ".st-workspace-card, .st-workspace-recent-item", function () {
			const name = String($(this).data("workspace-name") || "");
			const workspace = workspaces.find((item) => item.name === name);
			if (workspace) save_recent(workspace);
		});

		// Keep the native DesktopPage object intact; only its visual body is replaced.
		if (desktop) desktop.st_workspace_home_rendered = true;
	}

	saas_theme.professional_ui.render_workspace_home = render_workspace_home;
	saas_theme.professional_ui.get_workspaces = get_workspaces;

	$(document)
		.off("desktop_screen.saas_professional_ui")
		.on("desktop_screen.saas_professional_ui", function (_event, payload) {
			setTimeout(() => render_workspace_home(payload?.desktop), 0);
		});

	// Some v16 builds fire the custom event before an app's include file has completed.
	// Re-check when the page changes; the renderer is idempotent.
	$(document)
		.off("page-change.saas_professional_ui")
		.on("page-change.saas_professional_ui", function () {
			const route = frappe.get_route?.() || [];
			if (route[0] === "desktop" || route.length === 0) {
				setTimeout(() => render_workspace_home(frappe.pages?.desktop?.desktop_page), 60);
			}
		});

	$(function () {
		const route = frappe.get_route?.() || [];
		if (route[0] === "desktop" || route.length === 0) {
			setTimeout(() => render_workspace_home(frappe.pages?.desktop?.desktop_page), 120);
		}
	});
})();
