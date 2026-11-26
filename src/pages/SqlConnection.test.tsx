// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://hub.example.test/"}
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { SqlConnection } from "./SqlConnection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function submit(login: string) {
  render(<SqlConnection />);
  fireEvent.change(screen.getByLabelText("Database name"), { target: { value: "Reports" } });
  fireEvent.change(screen.getByLabelText("SQL login"), { target: { value: login } });
  const password = screen.getByLabelText("SQL password");
  fireEvent.change(password, { target: { value: "example-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  expect(password).toHaveValue("");
}

it("clears the password and rejects the SQL administrator login before making requests", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  submit(" SA ");
  expect(screen.getByRole("alert")).toHaveTextContent("The Hub blocks the SQL Server administrator login (sa)");
  expect(fetch).not.toHaveBeenCalled();
});

it("checks the connection with a CSRF token and displays only connection details", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ token: "csrf-token" }))
    .mockResolvedValueOnce(Response.json({
      host: "sql.example.test", port: 1433, database: "Reports", encryption: "Required",
    }));
  vi.stubGlobal("fetch", fetch);
  submit("report-reader");
  expect(await screen.findByRole("status")).toHaveTextContent("sql.example.test:1433");
  expect(fetch.mock.calls[1][0]).toBe("/api/sql/check");
  expect(fetch.mock.calls[1][1].headers["X-CSRF-TOKEN"]).toBe("csrf-token");
  expect(screen.queryByText("example-password")).not.toBeInTheDocument();
});
