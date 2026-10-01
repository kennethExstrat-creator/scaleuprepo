import { UpdatesListSkeleton } from "@/components/submission-form/form-skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <UpdatesListSkeleton />
    </div>
  );
}
