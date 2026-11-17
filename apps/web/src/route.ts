export const routeFromPath = () => {
  const value = location.pathname.split("/")[2];
  return [
    "today",
    "board",
    "calendar",
    "assistant",
    "archive",
    "settings",
  ].includes(value)
    ? value
    : "today";
};

const ROUTE_TITLES: Record<string, string> = {
  today: "Today",
  board: "My board",
  calendar: "Calendar",
  assistant: "Capture",
  archive: "Archive",
  settings: "Settings",
};

export function routeTitle(route: string) {
  return ROUTE_TITLES[route] ?? "Workroom";
}
