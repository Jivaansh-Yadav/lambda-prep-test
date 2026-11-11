import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContentUrl,
  dedupeRecords,
  isActivityRecord,
  isLessonRecord,
  mapActivityType,
  replaceSubjectBlock,
} from "./crawl-curriculum.mjs";

test("dedupeRecords prefers topic records over duplicated chapter records", () => {
  const records = [
    { contentId: "same", nodeType: "chapter", title: "A" },
    { contentId: "same", nodeType: "topic", title: "A" },
  ];

  assert.deepEqual(dedupeRecords(records), [records[1]]);
});

test("mapActivityType preserves Math Lab records and maps Senior-tagged Maths labs", () => {
  assert.equal(mapActivityType({ contentGroup: "Senior" }, "Mathematics"), "Math Lab");
  assert.equal(
    mapActivityType({ contentGroup: "Interactive Simulation" }, "Mathematics"),
    "Interactive Simulation",
  );
  assert.equal(mapActivityType({ contentGroup: "Senior" }, "Biology"), "Senior");
  assert.equal(
    mapActivityType({ contentGroup: "Case Study - EMR" }, "Mathematics"),
    "Case Study (HOTS)",
  );
});

test("isActivityRecord includes Practice HTML School Map content but not Learn PDFs", () => {
  assert.equal(
    isActivityRecord(
      { category: "Practice", contentType: "HTML", contentGroup: "School Map" },
      "History & Civics",
    ),
    true,
  );
  assert.equal(
    isActivityRecord(
      { category: "Learn", contentType: "PDF", contentGroup: "School Map" },
      "Geography",
    ),
    false,
  );
});

test("isLessonRecord includes only matching Animation CRS videos", () => {
  const record = {
    category: "Learn",
    contentType: "Animation",
    contentGroup: "CRS",
    rawUrl: "content_data/crsemr/public/resources/video/2091.mp4",
    tags: { Subject: "Computer Applications", Board: "ICSE ", Class: "X" },
  };

  assert.equal(
    isLessonRecord(record, { subjectName: "Computer Applications", board: "ICSE", className: "X" }),
    true,
  );
  assert.equal(
    isLessonRecord(record, { subjectName: "Mathematics", board: "ICSE", className: "X" }),
    false,
  );
  assert.equal(
    isLessonRecord(
      { ...record, tags: { ...record.tags, Board: "CBSE" } },
      { subjectName: "Computer Applications", board: "ICSE", className: "X" },
    ),
    false,
  );
});

test("isLessonRecord accepts both SLM content-group labels", () => {
  for (const contentGroup of ["SLM - EMR", "SLM"]) {
    assert.equal(
      isLessonRecord(
        { category: "Learn", contentType: "HTML", contentGroup },
        { subjectName: "Hindi", board: "ICSE", className: "X" },
      ),
      true,
    );
  }
});

test("buildContentUrl wraps bare PDF-tagged Virtual Labs", () => {
  const url = new URL(
    buildContentUrl({
      rawUrl: "content_data/school_virtual_lab/2021/02/06/123/dir_123",
      contentType: "PDF",
      contentGroup: "Virtual Lab",
    }),
  );

  assert.equal(url.pathname, "/template/154/dir24_154/index.html");
  assert.equal(
    url.searchParams.get("contentPath"),
    "https://mscontent-gcp.extramarks.com/content_data/school_virtual_lab/2021/02/06/123/dir_123/",
  );
  assert.equal(url.searchParams.get("isAllowFS"), "true");
});

test("replaceSubjectBlock updates only the selected subject and keeps JSON valid", () => {
  const original = `{
   "boards": {
      "ICSE": {
         "classes": {
            "X": {
               "subjects": [
                  {
                     "name": "Mathematics",
                     "chapters": []
                  },
                  {
                     "name": "Physics",
                     "chapters": []
                  }
               ]
            }
         }
      }
   }
}`;
  const replacement = {
    name: "Mathematics",
    chapters: [{ name: "Algebra", topics: [] }],
  };
  const updated = replaceSubjectBlock(
    original,
    {
      board: "ICSE",
      className: "X",
      subjectName: "Mathematics",
    },
    replacement,
  );
  const parsed = JSON.parse(updated);

  assert.deepEqual(parsed.boards.ICSE.classes.X.subjects[0], replacement);
  assert.deepEqual(parsed.boards.ICSE.classes.X.subjects[1], { name: "Physics", chapters: [] });
  assert.match(updated, /"name": "Physics"/);
});