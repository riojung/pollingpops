"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { WorkspaceProvider, useWorkspace } from "../../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../../components/workspace/workspace-shell";
import styles from "../../../components/workspace/workspace-content.module.css";
import { apiFetch, humanError } from "../../../lib/api";

type Room = { id: string; title: string; code: string; closed: boolean; closesAt: string };
function Surveys() {
  const { canEdit, productFeatures } = useWorkspace();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() {
    setError("");
    setLoading(true);
    try {
      async function pages<T>(path: string, key: string): Promise<T[]> {
        const rows: T[] = [];
        let cursor: string | null = null;
        do {
          const result: Record<string, T[] | string | null> = await apiFetch(
            `${path}?limit=50${cursor ? `&cursor=${cursor}` : ""}`,
          );
          rows.push(...(result[key] as T[]));
          cursor = result.nextCursor as string | null;
        } while (cursor);
        return rows;
      }
      const r = await pages<Room>("/v1/survey-rooms", "rooms");
      setRooms(r);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <WorkspaceShell
      title="Survey runs"
      eyebrow="Self-paced feedback"
      description="Opinion-only surveys, answered independently. Organizers see question-level results, never linked respondent rows."
      actions={
        canEdit && productFeatures?.surveys ? (
          <Link className="button" href="/surveys/new">
            Create Survey
          </Link>
        ) : (
          <Link className="button-quiet" href="/create">
            Create a Round
          </Link>
        )
      }
    >
      {!productFeatures?.surveys ? (
        <p className="notice">
          Survey creation is in an allowlisted beta. Existing surveys, submissions, and results
          remain available.
        </p>
      ) : null}
      {loading ? <p role="status">Loading surveys…</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error}{" "}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      ) : null}
      <p>
        <Link href="/library?type=surveys">Back to Survey library</Link>
      </p>
      <section className={styles.panel}>
        <h2>Shared surveys and results</h2>
        <p>
          Each sharing link creates a new, frozen survey run. Reruns never replace earlier evidence.
        </p>
        {!loading && !rooms.length ? (
          <p>
            No shared runs yet. Open a published Survey from the Library and create a sharing link.
          </p>
        ) : null}
        {rooms.map((room) => (
          <article className={styles.listCard} key={room.id}>
            <h3>
              <Link href={`/surveys/rooms/${room.id}`}>{room.title}</Link>
            </h3>
            <p>
              Code {room.code} ·{" "}
              {room.closed || new Date(room.closesAt) <= new Date() ? "Closed" : "Open"}
            </p>
          </article>
        ))}
      </section>
    </WorkspaceShell>
  );
}
export default function SurveysPage() {
  return (
    <WorkspaceProvider>
      <Surveys />
    </WorkspaceProvider>
  );
}
