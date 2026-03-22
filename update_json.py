import csv
import json
import os

csv_file = '/Volumes/Daniel SSD/Documents_SSD/Codes/STUDY/SAT VOCA/word_smart_clean.csv'
json_file = '/Volumes/Daniel SSD/Documents_SSD/Codes/STUDY/SAT VOCA/sat-vocab-app/words.json'

data = []
with open(csv_file, 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    for i, row in enumerate(reader):
        examples = [ex.strip() for ex in row.get("Examples", "").split("•") if ex.strip()]
        
        word_obj = {
            "id": f"word_{i}",
            "word": row.get("Word", "").strip(),
            "roots": row.get("Roots", "").strip(),
            "pronunciation": row.get("Pronunciation", "").strip(),
            "pos": row.get("Part_of_Speech", "").strip(),
            "definition": row.get("Definition", "").strip(),
            "examples": examples,
            "explanation": row.get("Explanation", "").strip()
        }
        data.append(word_obj)

with open(json_file, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"Successfully generated {json_file} with {len(data)} words.")
