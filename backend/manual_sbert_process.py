#!/usr/bin/env python3
"""
Manual SBERT Processing Script
Processes MCQ files to find similar pairs and automatically selects/removes duplicates.

Usage:
    python backend/manual_sbert_process.py

Configuration:
    Edit the CONFIG section below to change input/output paths and similarity range.
"""

import sys
import json
import os
from pathlib import Path
from typing import Dict, List, Tuple, Set
import re

# Add backend directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from sbert_processor import SBERTProcessor
from file_manager import FileManager

# ============================================================================
# CONFIGURATION - Edit these values as needed
# ============================================================================

# Input folder containing JSON files to process
INPUT_FOLDER = "/Users/mac/testpoint/classified_all_db-original/pakistan-studies"

# Output file path for removed files tracking
OUTPUT_FILE = "/Users/mac/testpoint/removed-track/pakistan-studies.json"

# Similarity range (0.98 = 98%, 1.0 = 100%)
MIN_SIMILARITY = 0.98
MAX_SIMILARITY = 1.0

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def extract_number_from_filename(filename: str) -> int:
    """Extract numeric part from filename for sorting (e.g., '21.json' -> 21)"""
    match = re.search(r'\d+', filename)
    return int(match.group()) if match else 999999

def sort_filenames_numerically(filenames: List[str]) -> List[str]:
    """Sort filenames numerically (1.json, 2.json, 10.json, 21.json)"""
    return sorted(filenames, key=extract_number_from_filename)

def load_json_file(filepath: str) -> Dict:
    """Load JSON file safely"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"  Warning: Failed to load {filepath}: {e}")
        return {}

def has_year_key(data: Dict) -> bool:
    """Check if JSON data has 'year' key at root level"""
    return 'year' in data and data.get('year') is not None

def get_year_value(data: Dict) -> int:
    """Get year value from JSON data, return large number if not present"""
    return data.get('year', 999999)

def select_best_mcq(files: List[str], input_folder: str) -> str:
    """
    Select best MCQ from a group based on priorities:
    1. Has 'year' key
    2. If both/none have year -> select by filename number (lower wins)
    3. If both have year -> select lesser year value
    """
    if len(files) == 0:
        return None
    if len(files) == 1:
        return files[0]
    
    # Load data for all files
    file_data = []
    for filename in files:
        filepath = os.path.join(input_folder, filename)
        data = load_json_file(filepath)
        has_year = has_year_key(data)
        year_value = get_year_value(data)
        file_num = extract_number_from_filename(filename)
        
        file_data.append({
            'filename': filename,
            'has_year': has_year,
            'year_value': year_value,
            'file_num': file_num
        })
    
    # Sort by priority:
    # 1. has_year (True first)
    # 2. year_value (lower first)
    # 3. file_num (lower first)
    file_data.sort(key=lambda x: (
        not x['has_year'],  # False (no year) comes after True (has year)
        x['year_value'],     # Lower year value first
        x['file_num']        # Lower file number first
    ))
    
    return file_data[0]['filename']

# ============================================================================
# MAIN PROCESSING LOGIC
# ============================================================================

def main():
    print("=" * 80)
    print("MANUAL SBERT PROCESSING")
    print("=" * 80)
    print(f"Input folder: {INPUT_FOLDER}")
    print(f"Output file: {OUTPUT_FILE}")
    print(f"Similarity range: {MIN_SIMILARITY * 100:.1f}% - {MAX_SIMILARITY * 100:.1f}%")
    print("=" * 80)
    print()
    
    # Step 1: Load existing removed-track file
    print("[Step 1] Loading existing removed-track file...")
    existing_removed = set()
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
                existing_removed = set(json.load(f))
            print(f"  Found {len(existing_removed)} files already in removed-track")
        except Exception as e:
            print(f"  Warning: Failed to load existing removed-track: {e}")
            existing_removed = set()
    else:
        print("  No existing removed-track file found (will create new one)")
    print()
    
    # Step 2: Initialize FileManager
    # We need to set up paths - using project root structure
    project_root = Path(INPUT_FOLDER).parent.parent
    classified_path = project_root / "classified_all_db"
    final_path = project_root / "final-db"
    removed_path = project_root / "removed_duplicates_db"
    
    file_manager = FileManager(
        str(classified_path),
        str(final_path),
        str(removed_path)
    )
    
    # Step 3: Load all MCQ files from input folder
    print(f"[Step 2] Loading MCQ files from {INPUT_FOLDER}...")
    subject_name = Path(INPUT_FOLDER).name
    
    # Load files directly from input folder (not using FileManager's subject path)
    all_mcqs = {}
    input_path = Path(INPUT_FOLDER)
    
    if not input_path.exists():
        print(f"  ERROR: Input folder does not exist: {INPUT_FOLDER}")
        return
    
    json_files = list(input_path.glob("*.json"))
    print(f"  Found {len(json_files)} JSON files")
    
    for json_file in json_files:
        filename = json_file.name
        # Skip files already in removed-track
        if filename in existing_removed:
            continue
        
        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                all_mcqs[filename] = data
        except Exception as e:
            print(f"  Warning: Failed to load {filename}: {e}")
    
    print(f"  Loaded {len(all_mcqs)} files (excluded {len(existing_removed)} already removed)")
    
    if len(all_mcqs) == 0:
        print("  ERROR: No files to process!")
        return
    print()
    
    # Step 4: Extract statements
    print("[Step 3] Extracting statements from MCQs...")
    statements = {}
    for filename, data in all_mcqs.items():
        try:
            if "mcq" in data and len(data["mcq"]) > 0:
                statement = data["mcq"][0].get("statement", "")
            else:
                statement = data.get("statement", "")
            
            if statement:
                statements[filename] = statement
        except Exception as e:
            print(f"  Warning: Failed to extract statement from {filename}: {e}")
    
    print(f"  Extracted {len(statements)} statements")
    print()
    
    # Step 5: Run SBERT processing
    print("[Step 4] Running SBERT similarity check...")
    print(f"  Processing {len(statements)} files...")
    
    sbert_processor = SBERTProcessor(threshold=MIN_SIMILARITY)
    
    try:
        embeddings, groups_pairwise, non_duplicate_count, similarity_bins = sbert_processor.process_subject(
            statements,
            cached_embeddings=None,
            progress_callback=None
        )
        
        print(f"  Found {len(groups_pairwise)} similar pairs")
        print(f"  Non-duplicate files: {non_duplicate_count}")
    except Exception as e:
        print(f"  ERROR: SBERT processing failed: {e}")
        import traceback
        traceback.print_exc()
        return
    finally:
        sbert_processor.stop()
    print()
    
    # Step 6: Filter groups to similarity range
    print(f"[Step 5] Filtering groups to similarity range {MIN_SIMILARITY * 100:.1f}% - {MAX_SIMILARITY * 100:.1f}%...")
    filtered_groups = []
    for group in groups_pairwise:
        similarity = group.get('similarity', 0)
        if MIN_SIMILARITY <= similarity <= MAX_SIMILARITY:
            filtered_groups.append(group)
    
    print(f"  Found {len(filtered_groups)} groups in similarity range")
    print()
    
    if len(filtered_groups) == 0:
        print("  No groups found in specified similarity range. Nothing to process.")
        return
    
    # Step 7: Process groups and track selections
    print("[Step 6] Processing groups and selecting MCQs...")
    
    # Track selections per file: {filename: [selected_in_group1, selected_in_group2, ...]}
    file_selections: Dict[str, List[bool]] = {}
    
    for idx, group in enumerate(filtered_groups):
        group_files = group['files']
        similarity = group.get('similarity', 0)
        
        if len(group_files) < 2:
            continue
        
        # Select best MCQ from this group
        selected_file = select_best_mcq(group_files, INPUT_FOLDER)
        unselected_files = [f for f in group_files if f != selected_file]
        
        # Track selections
        for filename in group_files:
            if filename not in file_selections:
                file_selections[filename] = []
            file_selections[filename].append(filename == selected_file)
        
        if (idx + 1) % 100 == 0:
            print(f"  Processed {idx + 1}/{len(filtered_groups)} groups...")
    
    print(f"  Processed {len(filtered_groups)} groups")
    print()
    
    # Step 8: Determine removed files (unselected in ALL groups)
    print("[Step 7] Determining removed files...")
    removed_files = set()
    
    for filename, selections in file_selections.items():
        # File is removed only if unselected in ALL groups it appears in
        if all(not selected for selected in selections):
            removed_files.add(filename)
    
    print(f"  Files to remove: {len(removed_files)}")
    print()
    
    # Step 9: Merge with existing removed-track
    print("[Step 8] Merging with existing removed-track...")
    all_removed = existing_removed.union(removed_files)
    newly_added = removed_files - existing_removed
    
    print(f"  Existing removed files: {len(existing_removed)}")
    print(f"  Newly removed files: {len(newly_added)}")
    print(f"  Total removed files: {len(all_removed)}")
    print()
    
    # Step 10: Save to output file
    print("[Step 9] Saving removed files to output file...")
    
    # Sort numerically
    sorted_removed = sort_filenames_numerically(list(all_removed))
    
    # Ensure output directory exists
    output_path = Path(OUTPUT_FILE)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    try:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(sorted_removed, f, indent=2)
        print(f"  Saved {len(sorted_removed)} files to {OUTPUT_FILE}")
    except Exception as e:
        print(f"  ERROR: Failed to save output file: {e}")
        return
    print()
    
    # Step 11: Print summary statistics
    print("=" * 80)
    print("SUMMARY STATISTICS")
    print("=" * 80)
    print(f"Total files processed: {len(all_mcqs)}")
    print(f"Files excluded (already removed): {len(existing_removed)}")
    print(f"Similar pairs found: {len(groups_pairwise)}")
    print(f"Groups in similarity range ({MIN_SIMILARITY * 100:.1f}%-{MAX_SIMILARITY * 100:.1f}%): {len(filtered_groups)}")
    print(f"Files appearing in groups: {len(file_selections)}")
    print(f"Files newly removed: {len(newly_added)}")
    print(f"Total removed files: {len(sorted_removed)}")
    print("=" * 80)
    print()
    print("Processing complete!")

if __name__ == "__main__":
    main()

