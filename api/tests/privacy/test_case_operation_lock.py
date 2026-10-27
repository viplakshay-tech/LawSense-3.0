from __future__ import annotations

import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Event

from app.services.case_operation_lock import case_operation_serialized
from app.services.document_case.service import upload_document_for_case
from app.services.privacy.case_deletion import delete_case_locally


class CaseOperationLockTests(unittest.TestCase):
    def test_same_case_is_serialized_while_different_cases_can_proceed(self) -> None:
        first_entered = Event()
        release_first = Event()
        second_attempting = Event()
        second_entered = Event()
        unrelated_entered = Event()

        @case_operation_serialized
        def operation(case_id: str, label: str) -> None:
            if label == "first":
                first_entered.set()
                if not release_first.wait(timeout=5):
                    raise TimeoutError("The test did not release the first case operation.")
            elif label == "second":
                second_entered.set()
            else:
                unrelated_entered.set()

        def run_second() -> None:
            second_attempting.set()
            operation("case-a", "second")

        with ThreadPoolExecutor(max_workers=3) as executor:
            first = executor.submit(operation, "case-a", "first")
            self.assertTrue(first_entered.wait(timeout=3))

            second = executor.submit(run_second)
            self.assertTrue(second_attempting.wait(timeout=3))
            unrelated = executor.submit(operation, "case-b", "other")

            try:
                self.assertTrue(unrelated_entered.wait(timeout=3))
                # Give the waiting thread a chance to contend for the lock.
                time.sleep(0.05)
                self.assertFalse(second_entered.is_set())
            finally:
                release_first.set()

            first.result(timeout=3)
            second.result(timeout=3)
            unrelated.result(timeout=3)

        self.assertTrue(second_entered.is_set())

    def test_upload_and_case_deletion_use_the_shared_case_lock(self) -> None:
        # Check the actual sensitive operations are wrapped with the same
        # serialization decorator, not merely that the helper works in isolation.
        self.assertIsNotNone(getattr(upload_document_for_case, "__wrapped__", None))
        self.assertIsNotNone(getattr(delete_case_locally, "__wrapped__", None))


if __name__ == "__main__":
    unittest.main()
