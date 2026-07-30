import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const png = (name: string) =>
  new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("selects and displays multiple images", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText("楽譜画像を選択").querySelector("input")!;
    await user.upload(input, [png("page-1.png"), png("page-2.png")]);
    expect(screen.getByText("page-1.png")).toBeInTheDocument();
    expect(screen.getByText("page-2.png")).toBeInTheDocument();
    expect(screen.getByText("2 / 20 枚")).toBeInTheDocument();
  });

  it("removes and reorders images", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText("楽譜画像を選択").querySelector("input")!;
    await user.upload(input, [png("first.png"), png("second.png")]);
    await user.click(screen.getByLabelText("second.png を上へ"));
    const filenames = screen.getAllByText(/(first|second)\.png/);
    expect(filenames[0]).toHaveTextContent("second.png");
    await user.click(screen.getByLabelText("first.png を削除"));
    expect(screen.queryByText("first.png")).not.toBeInTheDocument();
  });

  it("calls the conversion API and shows download", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          job_id: "job",
          measure_count: 2,
          note_count: 8,
          warning_count: 0,
          warnings: [],
          download_url: "/api/download/job",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText("楽譜画像を選択").querySelector("input")!;
    await user.upload(input, png("score.png"));
    await user.click(screen.getByRole("button", { name: /MusicXMLに変換/ }));
    await waitFor(() =>
      expect(screen.getByText("MusicXMLを生成しました")).toBeInTheDocument(),
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: /MusicXMLをダウンロード/ })).toHaveAttribute(
      "href",
      "/api/download/job",
    );
  });

  it("shows an API error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "TAB線を検出できませんでした" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<App />);
    const input = screen.getByLabelText("楽譜画像を選択").querySelector("input")!;
    fireEvent.change(input, { target: { files: [png("score.png")] } });
    fireEvent.click(screen.getByRole("button", { name: /MusicXMLに変換/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "TAB線を検出できませんでした",
    );
  });
});

