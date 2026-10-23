import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShellExperimentSwitch } from "./ShellExperimentSwitch";
const mocks = vi.hoisted(() => ({
  pro: true,
  personal: false,
  updateSettings: vi.fn(),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {
      enableShellTool: false,
      enablePersonalMode: mocks.personal,
      enableDyadPro: mocks.pro,
      providerSettings: { auto: { apiKey: { value: "test" } } },
    },
    updateSettings: mocks.updateSettings,
  }),
}));
afterEach(() => {
  cleanup();
  mocks.pro = true;
  mocks.personal = false;
  mocks.updateSettings.mockClear();
});
describe("Shell experiment", () => {
  it("persists the top-level setting", () => {
    render(<ShellExperimentSwitch />);
    fireEvent.click(screen.getByRole("switch", { name: "Shell tool" }));
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      enableShellTool: true,
    });
  });
  it("does not allow non-Pro users to enable it", () => {
    mocks.pro = false;
    render(<ShellExperimentSwitch />);
    fireEvent.click(screen.getByRole("switch", { name: "Shell tool" }));
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
  it("allows a Personal user to opt in without an official subscription", () => {
    mocks.pro = false;
    mocks.personal = true;
    render(<ShellExperimentSwitch />);
    fireEvent.click(screen.getByRole("switch", { name: "Shell tool" }));
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      enableShellTool: true,
    });
    expect(
      screen.getByText(/Personal mode reviews commands/).textContent,
    ).toContain("asks for approval every time");
  });
});

it("explains automatic host execution and fallible AI review before opting in", () => {
  render(<ShellExperimentSwitch />);
  expect(
    screen.getByText(/Commands run on your machine/).textContent,
  ).toContain("an AI safety review can make mistakes");
  expect(
    screen.getByText(/Commands run on your machine/).textContent,
  ).toContain("run automatically");
  expect(
    screen.getByText(/Commands run on your machine/).textContent,
  ).toContain("run_shell consent to Ask");
});
