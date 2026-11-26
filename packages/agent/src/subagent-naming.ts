/** The caller chooses the namesake; the host only validates the English spelling and makes it path-safe. */
export function artisticAgentName(raw: string | undefined): string {
  const name = raw?.trim().replace(/ +/g, "-");
  if (!name || name.length > 24 || !/^[A-Za-z]+(?:[-'][A-Za-z]+)*$/.test(name)) {
    throw new Error("Artistic naming requires spawn_agent.name: choose a real person whose work fits the task. Use a short English spelling (up to 24 characters), such as Turing for algorithms.");
  }
  return name;
}
