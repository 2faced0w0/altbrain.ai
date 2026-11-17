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
