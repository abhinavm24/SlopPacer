import "./styles.css";
import { prepareHistoryChartData } from "./history-chart";
import { combineSnapshots } from "./normalization";
import { calculatePacing, type PacingMetrics } from "./pacing";
import { PROVIDERS } from "./providers";
import { PROVIDER_IDS, type ExtensionMessage, type ExtensionState, type ProviderId } from "./types";

const providersHost = document.querySelector<HTMLElement>("#providers")!;
const refreshButton = document.querySelector<HTMLButtonElement>("#refresh")!;
const viewTitle = document.querySelector<HTMLElement>("#view-title")!;
const form = document.querySelector<HTMLFormElement>("#budget-form")!;
const saveStatus = document.querySelector<HTMLOutputElement>("#save-status")!;
let currentState: ExtensionState;
let currentView: "overview" | "history" | "settings" | "howto" = "overview";
let historyProvider: ProviderId = "claude";

function money(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

function pacingText(pacing: PacingMetrics): string {
  return `Avg ${money(pacing.averagePerElapsedDay)}/day · Available ${money(pacing.requiredPerRemainingDay)}/day`;
}

function paceClass(pacing: PacingMetrics): string {
  return `pace-${pacing.paceStatus.replace("_", "-")}`;
}

function setBar(bar: HTMLElement, usedPercent: number, pacing: PacingMetrics): void {
  const value = Math.max(0, Math.min(100, usedPercent));
  bar.style.width = `${value}%`;
  bar.className = paceClass(pacing);
  bar.parentElement?.setAttribute("aria-valuenow", String(Math.round(value)));
}

function chevron(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "m9 5 7 7-7 7");
  svg.append(path);
  return svg;
}

async function send<T>(message: ExtensionMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function render(state: ExtensionState): void {
  currentState = state;
  const snapshots = PROVIDER_IDS.flatMap((id) => state.providers[id].snapshot ? [state.providers[id].snapshot!] : []);
  const combined = combineSnapshots(snapshots);
  const combinedBudget = PROVIDER_IDS.reduce((sum, id) => sum + state.providers[id].budgetUsd, 0);
  const combinedRemaining = Math.max(0, combinedBudget - combined.usedUsd);
  const combinedRemainingPercent = combinedBudget ? (combinedRemaining / combinedBudget) * 100 : 0;
  const cycle = snapshots[0];
  const combinedPacing = cycle
    ? calculatePacing(combined.usedUsd, combinedBudget, cycle.cycleStart, cycle.cycleEnd)
    : undefined;

  document.querySelector("#combined-used")!.textContent = snapshots.length ? money(combined.usedUsd) : "—";
  document.querySelector("#combined-limit")!.textContent = `of ${money(combinedBudget)}`;
  document.querySelector("#summary-days")!.textContent = combinedPacing
    ? `${combinedPacing.remainingWorkingDays} days left`
    : "Current month";
  const remaining = document.querySelector<HTMLElement>("#combined-remaining")!;
  remaining.textContent = snapshots.length ? `${percent(combinedRemainingPercent)} remaining` : "No usage yet";
  remaining.className = combinedPacing ? `summary-remaining ${paceClass(combinedPacing)}` : "summary-remaining";
  const combinedBar = document.querySelector<HTMLElement>("#combined-bar")!;
  if (combinedPacing) setBar(combinedBar, combinedBudget ? (combined.usedUsd / combinedBudget) * 100 : 0, combinedPacing);
  document.querySelector("#summary-pacing")!.textContent = combinedPacing
    ? `Avg ${money(combinedPacing.averagePerElapsedDay)}/day · Available ${money(combinedPacing.requiredPerRemainingDay)}/day`
    : "No pacing yet";

  providersHost.replaceChildren(...PROVIDER_IDS.map((id) => {
    const provider = state.providers[id];
    const snapshot = provider.snapshot;
    const row = document.createElement("article");
    row.className = "provider-row";
    if (provider.message) row.title = provider.message;

    const identity = document.createElement("div");
    identity.className = "provider-identity";
    const name = document.createElement("strong");
    name.textContent = PROVIDERS[id].name;
    const amount = document.createElement("span");
    amount.textContent = snapshot ? `${money(snapshot.equivalentUsedUsd)} of ${money(snapshot.budgetUsd)}` : money(provider.budgetUsd);
    const updated = document.createElement("time");
    updated.className = "provider-updated";
    if (provider.lastSuccessAt) {
      updated.dateTime = provider.lastSuccessAt;
      updated.textContent = `Updated ${new Date(provider.lastSuccessAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    } else {
      updated.textContent = "Not updated";
    }
    identity.append(name, amount, updated);
    row.append(identity);

    if (snapshot) {
      const pacing = calculatePacing(snapshot.equivalentUsedUsd, snapshot.budgetUsd, snapshot.cycleStart, snapshot.cycleEnd);
      const metrics = document.createElement("div");
      metrics.className = "provider-metrics";
      const remainingLabel = document.createElement("strong");
      remainingLabel.className = paceClass(pacing);
      remainingLabel.textContent = `${percent(pacing.remainingPercent)} remaining`;
      const pace = document.createElement("span");
      pace.textContent = pacingText(pacing);
      const bar = document.createElement("div");
      bar.className = "usage-bar provider-bar";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", `${PROVIDERS[id].name} budget used`);
      const fill = document.createElement("span");
      setBar(fill, snapshot.utilizationPercent, pacing);
      bar.append(fill);
      metrics.append(remainingLabel, pace, bar);
      row.append(metrics);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = provider.status === "auth_required" ? "provider-action sign-in" : "provider-action chevron";
    button.setAttribute("aria-label", provider.status === "auth_required" ? `Sign in to ${PROVIDERS[id].name}` : `Open ${PROVIDERS[id].name} usage`);
    if (provider.status === "auth_required") button.textContent = "Sign in";
    else button.append(chevron());
    button.addEventListener("click", () => void openProvider(id));
    row.append(button);
    return row;
  }));

  if (currentView === "history") renderHistory();
}

function renderHistory(): void {
  renderHistoryChart();
  const tabs = document.querySelector<HTMLElement>("#history-tabs")!;
  tabs.replaceChildren(...PROVIDER_IDS.map((id) => {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.textContent = PROVIDERS[id].name;
    button.setAttribute("aria-selected", String(id === historyProvider));
    button.addEventListener("click", () => {
      historyProvider = id;
      renderHistory();
    });
    return button;
  }));

  const history = currentState.providers[historyProvider].history.slice().reverse();
  const list = document.querySelector<HTMLElement>("#history-list")!;
  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No history yet";
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...history.map((item) => {
    const row = document.createElement("div");
    row.className = "history-row";
    const date = document.createElement("span");
    date.textContent = new Date(`${item.date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    const value = document.createElement("strong");
    value.textContent = money(item.equivalentUsedUsd);
    row.append(date, value);
    return row;
  }));
}

function svgElement(tag: string, attributes: Record<string, string> = {}): SVGElement {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function chartMoney(value: number): string {
  const precision = Math.abs(value) < 10 && value !== 0 ? 1 : 0;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: precision,
  }).format(value);
}

function chartDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderHistoryChart(): void {
  const host = document.querySelector<HTMLElement>("#history-chart")!;
  const histories = Object.fromEntries(PROVIDER_IDS.map((provider) => [
    provider,
    currentState.providers[provider].history,
  ])) as Record<ProviderId, typeof currentState.providers[ProviderId]["history"]>;
  const data = prepareHistoryChartData(histories);
  if (!data.dates.length) {
    const empty = document.createElement("p");
    empty.className = "chart-empty-state";
    empty.textContent = "Refresh usage to build the daily chart";
    host.replaceChildren(empty);
    return;
  }

  const width = 374;
  const height = 132;
  const plot = { left: 42, right: 10, top: 8, bottom: 24 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const values = data.series.flatMap((series) => series.points.map((point) => point.value));
  let minimum = Math.min(0, ...values);
  let maximum = Math.max(0, ...values);
  if (minimum === maximum) maximum = minimum + 1;
  const firstDate = data.dates[0]!;
  const lastDate = data.dates[data.dates.length - 1]!;
  const dateStart = new Date(`${firstDate}T00:00:00`).getTime();
  const dateEnd = new Date(`${lastDate}T00:00:00`).getTime();
  const x = (date: string): number => {
    if (dateStart === dateEnd) return plot.left + plotWidth / 2;
    return plot.left + ((new Date(`${date}T00:00:00`).getTime() - dateStart) / (dateEnd - dateStart)) * plotWidth;
  };
  const y = (value: number): number => plot.top + ((maximum - value) / (maximum - minimum)) * plotHeight;

  const svg = svgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": "Daily dollar usage for Claude, ChatGPT, and Cursor",
  });
  const title = svgElement("title");
  title.textContent = "Daily usage by provider";
  const description = svgElement("desc");
  description.textContent = `${chartDate(firstDate)} through ${chartDate(lastDate)}`;
  svg.append(title, description);

  for (const value of [minimum, (minimum + maximum) / 2, maximum]) {
    const yPosition = y(value);
    svg.append(svgElement("line", {
      x1: String(plot.left), y1: String(yPosition), x2: String(width - plot.right), y2: String(yPosition), class: "chart-grid-line",
    }));
    const label = svgElement("text", { x: String(plot.left - 6), y: String(yPosition + 3), class: "chart-axis-label chart-y-label" });
    label.textContent = chartMoney(value);
    svg.append(label);
  }

  const labelIndices = [...new Set([0, Math.floor((data.dates.length - 1) / 2), data.dates.length - 1])];
  for (const index of labelIndices) {
    const date = data.dates[index];
    if (!date) continue;
    const label = svgElement("text", {
      x: String(x(date)), y: String(height - 5), class: "chart-axis-label chart-x-label",
    });
    label.textContent = chartDate(date);
    svg.append(label);
  }

  for (const series of data.series) {
    const pathData = series.points.map((point, index) => `${index ? "L" : "M"}${x(point.date)} ${y(point.value)}`).join(" ");
    if (pathData) svg.append(svgElement("path", { d: pathData, class: `chart-series series-${series.provider}` }));
    for (const point of series.points) {
      const circle = svgElement("circle", {
        cx: String(x(point.date)), cy: String(y(point.value)), r: "2.6", class: `chart-point series-${series.provider}`,
      });
      const pointTitle = svgElement("title");
      pointTitle.textContent = `${PROVIDERS[series.provider].name} · ${chartDate(point.date)} · ${chartMoney(point.value)}`;
      circle.append(pointTitle);
      svg.append(circle);
    }
  }
  host.replaceChildren(svg);
}

function populateSettings(): void {
  for (const provider of PROVIDER_IDS) {
    (form.elements.namedItem(provider) as HTMLInputElement).value = String(currentState.providers[provider].budgetUsd);
  }
  (form.elements.namedItem("retentionMonths") as HTMLInputElement).value = String(currentState.settings.retentionMonths);
  (form.elements.namedItem("syncMinutes") as HTMLInputElement).value = String(currentState.settings.syncMinutes);
  (form.elements.namedItem("allowScheduledCursorFocus") as HTMLInputElement).checked = currentState.settings.allowScheduledCursorFocus;
  saveStatus.textContent = "";
}

function showView(view: typeof currentView): void {
  currentView = view;
  for (const name of ["overview", "history", "settings", "howto"] as const) {
    document.querySelector<HTMLElement>(`#${name}-view`)!.hidden = name !== view;
  }
  for (const [id, target] of [
    ["home", "overview"],
    ["details", "history"],
    ["settings", "settings"],
    ["howto", "howto"],
  ] as const) {
    const button = document.querySelector<HTMLElement>(`#${id}`)!;
    if (view === target) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  viewTitle.replaceChildren();
  if (view === "overview") {
    viewTitle.textContent = "Slop Pacer";
  } else {
    viewTitle.textContent = view === "history" ? "History" : view === "settings" ? "Settings" : "How it works";
  }
  if (view === "history") renderHistory();
  if (view === "settings") populateSettings();
}

async function openProvider(provider: ProviderId): Promise<void> {
  render(await send<ExtensionState>({ type: "OPEN_SIGN_IN", provider }));
}

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  render(await send<ExtensionState>({ type: "REFRESH_ALL" }));
  refreshButton.disabled = false;
});

document.querySelector("#home")?.addEventListener("click", () => showView("overview"));
document.querySelector("#settings")?.addEventListener("click", () => showView("settings"));
document.querySelector("#details")?.addEventListener("click", () => showView("history"));
document.querySelector("#howto")?.addEventListener("click", () => showView("howto"));

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const budgets = Object.fromEntries(PROVIDER_IDS.map((provider) => [
    provider,
    Number((form.elements.namedItem(provider) as HTMLInputElement).value),
  ])) as Record<ProviderId, number>;
  const retention = Number((form.elements.namedItem("retentionMonths") as HTMLInputElement).value);
  const syncMinutes = Number((form.elements.namedItem("syncMinutes") as HTMLInputElement).value);
  const allowScheduledCursorFocus = (form.elements.namedItem("allowScheduledCursorFocus") as HTMLInputElement).checked;
  void send<ExtensionState>({
    type: "SAVE_SETTINGS",
    budgets,
    retentionMonths: retention,
    syncMinutes,
    allowScheduledCursorFocus,
  }).then((state) => {
    render(state);
    saveStatus.textContent = `Saved · every ${state.settings.syncMinutes} min`;
  });
});

document.querySelector("#export")?.addEventListener("click", async () => {
  const data = await send<ExtensionState>({ type: "EXPORT_DATA" });
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `slop-pacer-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

document.querySelector("#reset")?.addEventListener("click", async () => {
  if (!confirm("Clear all locally stored daily history? Current totals and settings will be kept.")) return;
  render(await send<ExtensionState>({ type: "RESET_HISTORY" }));
  saveStatus.textContent = "History cleared";
});

void send<ExtensionState>({ type: "GET_STATE" }).then(render);
