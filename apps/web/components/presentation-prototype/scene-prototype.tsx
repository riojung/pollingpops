"use client";

import { useEffect, useState } from "react";
import {
  CanvasColorSchema,
  CanvasShapeVariantSchema,
  PresentationScenePrototypeSchema,
  type PresentationScenePrototype,
  type PresentationScenePrototypeNode,
} from "@openround/contracts";
import {
  getPresentationSceneFixture,
  presentationSceneFixtures,
} from "../../lib/presentation-scene-fixtures";
import {
  boundPrototypeFrame,
  createPresentationSceneWorkspace,
  parsePresentationSceneWorkspace,
  PRESENTATION_SCENE_STORAGE_KEY,
  serializePresentationSceneWorkspace,
  type PresentationSceneWorkspace,
} from "../../lib/presentation-scene-storage";
import { PresentationSceneView, prototypeNodeLabel, prototypeSlideTitle } from "./scene-view";
import styles from "./scene-prototype.module.css";

const shapeOptions = [
  ...CanvasShapeVariantSchema.options,
  "ellipse",
  "diamond",
  "parallelogram",
] as const;
const anchors = ["center", "top", "right", "bottom", "left"] as const;

export function PresentationScenePrototypeLab() {
  const [{ workspace, status }, setSession] = useState(() => ({
    workspace: createPresentationSceneWorkspace(),
    status: "Loading local work…",
  }));
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [readingView, setReadingView] = useState(false);
  const fixture = getPresentationSceneFixture(workspace.activeFixtureId)!;
  const deck = workspace.decks.find((item) => item.fixtureId === fixture.id)!;
  const scene = deck.slides.find((slide) => slide.id === deck.activeSlideId)!;
  const selected = scene.nodes.find((node) => node.id === selectedId) ?? scene.nodes[0]!;
  const readingIndex = scene.readingOrder.indexOf(selected.id);

  function setWorkspace(
    update:
      | PresentationSceneWorkspace
      | ((current: PresentationSceneWorkspace) => PresentationSceneWorkspace),
  ) {
    setSession((current) => ({
      ...current,
      workspace: typeof update === "function" ? update(current.workspace) : update,
    }));
  }

  function setStatus(nextStatus: string) {
    setSession((current) => ({ ...current, status: nextStatus }));
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PRESENTATION_SCENE_STORAGE_KEY);
      if (raw !== null) {
        setWorkspace(parsePresentationSceneWorkspace(raw));
        setStatus("Restored local work");
      } else setStatus("Fixture ready · no local copy saved");
    } catch {
      setStatus("Local work could not be restored. Stored data was left unchanged.");
    }
    setLoaded(true);
  }, []);

  function updateScene(
    update: (current: PresentationScenePrototype) => PresentationScenePrototype,
  ) {
    setSession((current) => {
      const latest = current.workspace.decks
        .find((item) => item.fixtureId === deck.fixtureId)!
        .slides.find((slide) => slide.id === scene.id)!;
      const parsed = PresentationScenePrototypeSchema.safeParse(update(latest));
      if (!parsed.success)
        return {
          ...current,
          status: parsed.error.issues[0]?.message ?? "The edit could not be applied.",
        };
      return {
        status: "Unsaved local changes",
        workspace: {
          ...current.workspace,
          decks: current.workspace.decks.map((item) =>
            item.fixtureId !== deck.fixtureId
              ? item
              : {
                  ...item,
                  slides: item.slides.map((slide) => (slide.id === scene.id ? parsed.data : slide)),
                },
          ),
        },
      };
    });
  }

  function updateNode(
    id: string,
    update: (node: PresentationScenePrototypeNode) => PresentationScenePrototypeNode,
  ) {
    updateScene((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === id ? update(node) : node)),
    }));
  }

  function changeWorkspace(
    update: (current: PresentationSceneWorkspace) => PresentationSceneWorkspace,
  ) {
    setWorkspace(update);
    setSelectedId("");
    setStatus("Unsaved local changes");
  }

  function save() {
    try {
      window.localStorage.setItem(
        PRESENTATION_SCENE_STORAGE_KEY,
        serializePresentationSceneWorkspace(workspace),
      );
      setStatus("Saved on this browser");
    } catch {
      setStatus(
        "Could not save locally. Your working copy is still available; browser storage may be blocked or full.",
      );
    }
  }

  function reloadSaved() {
    try {
      const raw = window.localStorage.getItem(PRESENTATION_SCENE_STORAGE_KEY);
      if (raw === null) {
        setStatus("No local copy has been saved yet.");
        return;
      }
      setWorkspace(parsePresentationSceneWorkspace(raw));
      setSelectedId("");
      setStatus("Restored local work");
    } catch {
      setStatus(
        "Local work could not be restored. Your working copy and stored data were left unchanged.",
      );
    }
  }

  function shiftReadingOrder(delta: number) {
    const nextIndex = readingIndex + delta;
    if (nextIndex < 0 || nextIndex >= scene.readingOrder.length) return;
    updateScene((current) => {
      const readingOrder = [...current.readingOrder];
      [readingOrder[readingIndex], readingOrder[nextIndex]] = [
        readingOrder[nextIndex]!,
        readingOrder[readingIndex]!,
      ];
      return { ...current, readingOrder };
    });
  }

  return (
    <main className={styles.lab}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Polling Pops · Development prototype</p>
          <h1>Presentation scene lab</h1>
          <p>Create and arrange a slide, then check its reading order and local recovery.</p>
        </div>
        <span className={styles.badge}>E00</span>
      </header>
      <div className={styles.toolbar}>
        <label>
          Task deck
          <select
            value={fixture.id}
            disabled={!loaded}
            onChange={(event) =>
              changeWorkspace((current) => ({ ...current, activeFixtureId: event.target.value }))
            }
          >
            {presentationSceneFixtures.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="button" disabled={!loaded} onClick={save}>
          Save locally
        </button>
        <button type="button" className="button-secondary" disabled={!loaded} onClick={reloadSaved}>
          Reload saved
        </button>
        <button
          type="button"
          className="button-secondary"
          aria-pressed={readingView}
          onClick={() => setReadingView((current) => !current)}
        >
          Reading view
        </button>
        <p className={styles.status} role="status">
          {status}
        </p>
      </div>
      <p className={styles.localNote}>
        Original task material only. Saved work stays in this browser; it is separate from your
        Library and live sessions.
      </p>
      <div className={styles.workspace}>
        <nav className={styles.filmstrip} aria-label="Slides">
          {deck.slides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              aria-current={slide.id === scene.id ? "step" : undefined}
              onClick={() =>
                changeWorkspace((current) => ({
                  ...current,
                  decks: current.decks.map((item) =>
                    item.fixtureId === deck.fixtureId ? { ...item, activeSlideId: slide.id } : item,
                  ),
                }))
              }
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <span>{prototypeSlideTitle(slide)}</span>
            </button>
          ))}
        </nav>
        <section className={styles.canvasColumn} aria-label="Slide workspace">
          <div className={styles.canvasHeading}>
            <h2>
              Slide {deck.slides.indexOf(scene) + 1} of {deck.slides.length}
            </h2>
            <span>{readingView ? "Semantic reading order" : "16:9 stage"}</span>
          </div>
          <PresentationSceneView
            key={scene.id}
            scene={scene}
            readingView={readingView}
            selectedNodeId={readingView ? undefined : selected.id}
            onSelect={setSelectedId}
            onFrameChange={(id, frame) =>
              updateNode(id, (node) => (node.type === "connector" ? node : { ...node, frame }))
            }
          />
          <label className={styles.notes}>
            Speaker notes
            <textarea
              maxLength={2000}
              rows={3}
              value={scene.speakerNotes}
              onChange={(event) =>
                updateScene((current) => ({ ...current, speakerNotes: event.target.value }))
              }
            />
          </label>
          <details className={styles.taskDetails}>
            <summary>Task instructions and observations</summary>
            <p>{fixture.job}</p>
            <ol>
              {fixture.taskInstructions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
            <h3>Observe during a real task</h3>
            <ul>
              {fixture.observationChecklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        </section>
        <aside className={styles.inspector} aria-label="Slide inspector">
          <h2>Slide elements</h2>
          <p className={styles.hint}>Order here is the screen reader and phone reading order.</p>
          <ol className={styles.nodeList}>
            {scene.readingOrder.map((id) => {
              const node = scene.nodes.find((item) => item.id === id)!;
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-pressed={selected.id === id}
                    onClick={() => setSelectedId(id)}
                  >
                    {prototypeNodeLabel(node)}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className={styles.orderButtons}>
            <button
              type="button"
              className="button-secondary small-button"
              disabled={readingIndex === 0}
              onClick={() => shiftReadingOrder(-1)}
            >
              Read earlier
            </button>
            <button
              type="button"
              className="button-secondary small-button"
              disabled={readingIndex === scene.readingOrder.length - 1}
              onClick={() => shiftReadingOrder(1)}
            >
              Read later
            </button>
          </div>
          <h3>Selected {prototypeNodeLabel(selected).toLowerCase()}</h3>
          {selected.type === "text" ? (
            <label>
              Text
              <textarea
                maxLength={selected.role === "title" ? 160 : 4000}
                rows={5}
                value={selected.text}
                onChange={(event) =>
                  updateNode(selected.id, (node) =>
                    node.type === "text" ? { ...node, text: event.target.value } : node,
                  )
                }
              />
            </label>
          ) : null}
          {selected.type === "image" ? (
            <label>
              Image description
              <textarea
                maxLength={300}
                rows={3}
                value={selected.altText ?? ""}
                onChange={(event) =>
                  updateNode(selected.id, (node) =>
                    node.type === "image" ? { ...node, altText: event.target.value } : node,
                  )
                }
              />
            </label>
          ) : null}
          {selected.type === "shape" ? (
            <label>
              Shape
              <select
                value={selected.shape}
                onChange={(event) =>
                  updateNode(selected.id, (node) =>
                    node.type === "shape"
                      ? { ...node, shape: event.target.value as typeof node.shape }
                      : node,
                  )
                }
              >
                {shapeOptions.map((shape) => (
                  <option key={shape} value={shape}>
                    {shape.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {selected.type === "shape" || selected.type === "connector" ? (
            <label>
              Color
              <select
                value={selected.color}
                onChange={(event) =>
                  updateNode(selected.id, (node) =>
                    node.type === "shape" || node.type === "connector"
                      ? { ...node, color: event.target.value as typeof node.color }
                      : node,
                  )
                }
              >
                {CanvasColorSchema.options.map((color) => (
                  <option key={color} value={color}>
                    {color}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {selected.type === "connector" ? (
            <>
              <label>
                Connection label
                <input
                  maxLength={200}
                  value={selected.label}
                  onChange={(event) =>
                    updateNode(selected.id, (node) =>
                      node.type === "connector" ? { ...node, label: event.target.value } : node,
                    )
                  }
                />
              </label>
              {(["from", "to"] as const).map((side) => (
                <div key={side} className={styles.endpoint}>
                  <label>
                    {side === "from" ? "From element" : "To element"}
                    <select
                      value={selected[side].nodeId}
                      onChange={(event) =>
                        updateNode(selected.id, (node) =>
                          node.type === "connector"
                            ? { ...node, [side]: { ...node[side], nodeId: event.target.value } }
                            : node,
                        )
                      }
                    >
                      {scene.nodes
                        .filter(
                          (node) =>
                            node.type !== "connector" &&
                            node.id !== selected[side === "from" ? "to" : "from"].nodeId,
                        )
                        .map((node) => (
                          <option key={node.id} value={node.id}>
                            {prototypeNodeLabel(node)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    {side === "from" ? "From anchor" : "To anchor"}
                    <select
                      value={selected[side].anchor}
                      onChange={(event) =>
                        updateNode(selected.id, (node) =>
                          node.type === "connector"
                            ? { ...node, [side]: { ...node[side], anchor: event.target.value } }
                            : node,
                        )
                      }
                    >
                      {anchors.map((anchor) => (
                        <option key={anchor} value={anchor}>
                          {anchor}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </>
          ) : (
            <fieldset className={styles.geometry}>
              <legend>Position and size (%)</legend>
              {(["x", "y", "width", "height"] as const).map((field) => (
                <label key={field}>
                  {field === "x"
                    ? "Left"
                    : field === "y"
                      ? "Top"
                      : field === "width"
                        ? "Width"
                        : "Height"}
                  <input
                    type="number"
                    min={field === "width" || field === "height" ? 1 : 0}
                    max={100}
                    step="any"
                    value={Math.round(selected.frame[field] * 100) / 100}
                    onChange={(event) => {
                      if (event.target.value === "") return;
                      const value = Number(event.target.value);
                      if (Number.isFinite(value))
                        updateNode(selected.id, (node) =>
                          node.type === "connector"
                            ? node
                            : {
                                ...node,
                                frame: boundPrototypeFrame({ ...node.frame, [field]: value }),
                              },
                        );
                    }}
                  />
                </label>
              ))}
            </fieldset>
          )}
          <button
            type="button"
            className="button-quiet"
            onClick={() => {
              changeWorkspace((current) => ({
                ...current,
                decks: current.decks.map((item) =>
                  item.fixtureId === fixture.id
                    ? {
                        fixtureId: fixture.id,
                        activeSlideId: fixture.slides[0]!.id,
                        slides: structuredClone(fixture.slides),
                      }
                    : item,
                ),
              }));
            }}
          >
            Reset working deck
          </button>
          <p className={styles.hint}>
            Reset changes only this working deck. Reload saved restores your last saved workspace.
          </p>
        </aside>
      </div>
    </main>
  );
}
