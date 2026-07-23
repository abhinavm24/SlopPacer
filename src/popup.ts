import "./styles.css";
import {
  MAX_BACKUP_BYTES,
  backupErrorMessage,
  parseBackupText,
  parseBackupValue,
} from "./backup";
import { prepareHistoryChartData } from "./history-chart";
import {
  parseImportDataResponse,
  type ExtensionMessage,
  type ExtensionResponse,
} from "./messages";
import { combineSnapshots } from "./normalization";
import { calculatePacing, type PacingMetrics } from "./pacing";
import { computeSummary, fillStatus, type SummaryBreakdown } from "./periods";
import { PROVIDERS } from "./providers";
import { PROVIDER_IDS, type ExtensionState, type ProviderId } from "./types";

const providersHost = document.querySelector<HTMLElement>("#providers")!;
const refreshButton = document.querySelector<HTMLButtonElement>("#refresh")!;
const viewTitle = document.querySelector<HTMLElement>("#view-title")!;
const form = document.querySelector<HTMLFormElement>("#budget-form")!;
const saveStatus = document.querySelector<HTMLOutputElement>("#save-status")!;
const exportButton = document.querySelector<HTMLButtonElement>("#export")!;
const importButton = document.querySelector<HTMLButtonElement>("#import")!;
const importFile = document.querySelector<HTMLInputElement>("#import-file")!;
const resetButton = document.querySelector<HTMLButtonElement>("#reset")!;
const dataStatus = document.querySelector<HTMLOutputElement>("#data-status")!;
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

function setFill(fill: HTMLElement, spent: number, target: number): void {
  const value = target <= 0 ? (spent > 0 ? 100 : 0) : Math.max(0, Math.min(100, (spent / target) * 100));
  fill.style.width = `${value}%`;
  fill.className = `fill-${fillStatus(spent, target)}`;
  fill.parentElement?.setAttribute("aria-valuenow", String(Math.round(value)));
}

function setPeriodBar(fillId: string, labelId: string, spent: number, target: number): void {
  setFill(document.querySelector<HTMLElement>(`#${fillId}`)!, spent, target);
  document.querySelector(`#${labelId}`)!.textContent = `${money(spent)} / ${money(target)}`;
}

function renderSummary(summary: SummaryBreakdown | undefined): void {
  const today = document.querySelector<HTMLElement>("#combined-today")!;
  const days = document.querySelector<HTMLElement>("#summary-days")!;
  const allowance = document.querySelector<HTMLElement>("#summary-allowance")!;
  const foot = document.querySelector<HTMLElement>("#summary-foot")!;
  if (!summary) {
    today.textContent = "—";
    days.textContent = "Current month";
    allowance.textContent = "No usage yet";
    foot.textContent = "";
    for (const [fillId, labelId] of [
      ["today-fill", "today-label"],
      ["week-fill", "week-label"],
      ["month-fill", "month-label"],
    ] as const) {
      const fill = document.querySelector<HTMLElement>(`#${fillId}`)!;
      fill.style.width = "0%";
      fill.className = "";
      document.querySelector(`#${labelId}`)!.textContent = "";
    }
    return;
  }
  today.textContent = money(summary.todaySpent);
  days.textContent = `${summary.remainingWorkingDays} days left`;
  allowance.textContent =
    `today · allowance ${money(summary.todayAllowance)} (${money(summary.todayAllowanceAllDays)})`;
  setPeriodBar("today-fill", "today-label", summary.todaySpent, summary.todayAllowance);
  setPeriodBar("week-fill", "week-label", summary.weekSpent, summary.weekTarget);
  setPeriodBar("month-fill", "month-label", summary.monthSpent, summary.monthBudget);
  foot.textContent = `proj ${money(summary.projectedMonth)} · left ${money(summary.left)}`;
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

async function send<Message extends ExtensionMessage>(
  message: Message,
): Promise<ExtensionResponse<Message>> {
  return chrome.runtime.sendMessage(message) as Promise<ExtensionResponse<Message>>;
}

function setDataControlsDisabled(disabled: boolean): void {
  exportButton.disabled = disabled;
  importButton.disabled = disabled;
  resetButton.disabled = disabled;
}

function setDataStatus(message: string, isError = false): void {
  dataStatus.textContent = message;
  dataStatus.classList.toggle("error", isError);
}

function backupDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function importBackupFile(file: File): Promise<void> {
  setDataControlsDisabled(true);
  setDataStatus("");
  try {
    if (file.size > MAX_BACKUP_BYTES) {
      throw new Error("The selected backup is larger than 1 MiB.");
    }
    const parsed = parseBackupText(await file.text());
    if (!parsed.ok) throw new Error(backupErrorMessage(parsed.error));

    const exportedOn = backupDate(parsed.backup.exportedAt);
    if (!confirm(
      `Import backup from ${exportedOn}?\n\nThis will replace all local Slop Pacer data.`,
    )) {
      setDataStatus("Import cancelled");
      return;
    }

    const result = parseImportDataResponse(await send({
      type: "IMPORT_DATA",
      backup: parsed.backup,
    }));
    if (!result) throw new Error("Slop Pacer could not restore that backup.");
    if (!result.ok) throw new Error(backupErrorMessage(result.error));

    render(result.state);
    populateSettings();
    setDataStatus(`Imported backup from ${backupDate(result.exportedAt)}`);
  } catch (error: unknown) {
    setDataStatus(
      error instanceof Error ? error.message : "Slop Pacer could not restore that backup.",
      true,
    );
  } finally {
    importFile.value = "";
    setDataControlsDisabled(false);
  }
}

function render(state: ExtensionState): void {
  currentState = state;
  const snapshots = PROVIDER_IDS.flatMap((id) => state.providers[id].snapshot ? [state.providers[id].snapshot!] : []);
  const combined = combineSnapshots(snapshots);
  const combinedBudget = PROVIDER_IDS.reduce((sum, id) => sum + state.providers[id].budgetUsd, 0);
  const cycle = snapshots[0];
  const summary = cycle
    ? computeSummary(
        PROVIDER_IDS.map((id) => state.providers[id].history),
        combined.usedUsd,
        combinedBudget,
        cycle.cycleStart,
        cycle.cycleEnd,
      )
    : undefined;

  renderSummary(summary);

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
      const status = fillStatus(snapshot.equivalentUsedUsd, snapshot.budgetUsd);
      const metrics = document.createElement("div");
      metrics.className = "provider-metrics";
      const remainingLabel = document.createElement("strong");
      remainingLabel.className = `text-${status}`;
      remainingLabel.textContent = `${percent(pacing.remainingPercent)} remaining`;
      const pace = document.createElement("span");
      pace.textContent = pacingText(pacing);
      const bar = document.createElement("div");
      bar.className = "usage-bar provider-bar";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", `${PROVIDERS[id].name} budget used`);
      const fill = document.createElement("span");
      setFill(fill, snapshot.equivalentUsedUsd, snapshot.budgetUsd);
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
  render(await send({ type: "OPEN_SIGN_IN", provider }));
}

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  render(await send({ type: "REFRESH_ALL" }));
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
  void send({
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

exportButton.addEventListener("click", async () => {
  setDataControlsDisabled(true);
  setDataStatus("");
  try {
    const response = await send({ type: "EXPORT_DATA" });
    const parsed = parseBackupValue(response);
    if (!parsed.ok) throw new Error("Slop Pacer could not export a backup.");
    const backup = parsed.backup;
    const url = URL.createObjectURL(new Blob(
      [JSON.stringify(backup, null, 2)],
      { type: "application/json" },
    ));
    const link = document.createElement("a");
    link.href = url;
    link.download = `slop-pacer-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setDataStatus("Backup exported");
  } catch {
    setDataStatus("Slop Pacer could not export a backup.", true);
  } finally {
    setDataControlsDisabled(false);
  }
});

importButton.addEventListener("click", () => importFile.click());

importFile.addEventListener("change", () => {
  const file = importFile.files?.[0];
  if (!file) return;
  void importBackupFile(file);
});

resetButton.addEventListener("click", async () => {
  if (!confirm("Clear all locally stored daily history? Current totals and settings will be kept.")) return;
  render(await send({ type: "RESET_HISTORY" }));
  setDataStatus("History cleared");
});

void send({ type: "GET_STATE" }).then(render);
