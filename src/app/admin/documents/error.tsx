"use client";

import { DocumentsError } from "@/components/documents/documents-error";

export default function AdminDocumentsError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <DocumentsError {...props} />;
}
