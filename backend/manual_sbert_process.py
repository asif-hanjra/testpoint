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
INPUT_FOLDER = "/Users/mac/testpoint/classified_all_db/everyday-science"

# Output file path for removed files tracking
OUTPUT_FILE = "/Users/mac/testpoint/removed-track/everyday-science.json"

# Saved-track file path for non-duplicate files
SAVED_TRACK_FILE = "/Users/mac/testpoint/saved-track/everyday-science.json"

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
    print(f"Removed-track file: {OUTPUT_FILE}")
    print(f"Saved-track file: {SAVED_TRACK_FILE}")
    print(f"Similarity range: {MIN_SIMILARITY * 100:.1f}% - {MAX_SIMILARITY * 100:.1f}%")
    print("=" * 80)
    print()
    
    # Step 1: Load existing tracking files
    print("[Step 1] Loading existing tracking files...")
    
    # Load removed-track
    existing_removed = set()
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
                existing_removed = set(json.load(f))
            print(f"  ✓ Removed-track: Found {len(existing_removed):,} files")
        except Exception as e:
            print(f"  ⚠ Warning: Failed to load removed-track: {e}")
            existing_removed = set()
    else:
        print(f"  ✓ Removed-track: No existing file (will create new one)")
    
    # Load saved-track
    existing_saved = set()
    if os.path.exists(SAVED_TRACK_FILE):
        try:
            with open(SAVED_TRACK_FILE, 'r', encoding='utf-8') as f:
                existing_saved = set(json.load(f))
            print(f"  ✓ Saved-track: Found {len(existing_saved):,} files")
        except Exception as e:
            print(f"  ⚠ Warning: Failed to load saved-track: {e}")
            existing_saved = set()
    else:
        print(f"  ✓ Saved-track: No existing file (will create new one)")
    
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
    
    # Step 2: Load all MCQ files from input folder (excluding removed-track and saved-track)
    print(f"[Step 2] Loading MCQ files from {INPUT_FOLDER}...")
    subject_name = Path(INPUT_FOLDER).name
    
    # Load files directly from input folder (not using FileManager's subject path)
    all_mcqs = {}
    input_path = Path(INPUT_FOLDER)
    
    if not input_path.exists():
        print(f"  ❌ ERROR: Input folder does not exist: {INPUT_FOLDER}")
        return
    
    json_files = list(input_path.glob("*.json"))
    print(f"  Found {len(json_files):,} JSON files in input folder")
    
    excluded_removed = 0
    excluded_saved = 0
    
    for json_file in json_files:
        filename = json_file.name
        # Skip files already in removed-track
        if filename in existing_removed:
            excluded_removed += 1
            continue
        # Skip files already in saved-track
        if filename in existing_saved:
            excluded_saved += 1
            continue
        
        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                all_mcqs[filename] = data
        except Exception as e:
            print(f"  ⚠ Warning: Failed to load {filename}: {e}")
    
    print(f"  ✓ Loaded {len(all_mcqs):,} files for processing")
    print(f"  - Excluded {excluded_removed:,} files (already in removed-track)")
    print(f"  - Excluded {excluded_saved:,} files (already in saved-track)")
    
    if len(all_mcqs) == 0:
        print("  ❌ ERROR: No files to process after exclusions!")
        return
    print()
    
    # Step 3: Extract statements
    print("[Step 3] Extracting statements from MCQs...")
    statements = {}
    failed_extractions = 0
    
    for filename, data in all_mcqs.items():
        try:
            if "mcq" in data and len(data["mcq"]) > 0:
                statement = data["mcq"][0].get("statement", "")
            else:
                statement = data.get("statement", "")
            
            if statement:
                statements[filename] = statement
            else:
                failed_extractions += 1
        except Exception as e:
            print(f"  ⚠ Warning: Failed to extract statement from {filename}: {e}")
            failed_extractions += 1
    
    print(f"  ✓ Extracted {len(statements):,} statements")
    if failed_extractions > 0:
        print(f"  ⚠ Failed to extract {failed_extractions:,} statements")
    print()
    
    # Step 4: Run SBERT processing
    print("[Step 4] Running SBERT similarity check...")
    print(f"  Processing {len(statements):,} files for similarity detection...")
    print()
    
    sbert_processor = SBERTProcessor(threshold=MIN_SIMILARITY)
    
    try:
        embeddings, groups_pairwise, non_duplicate_count, similarity_bins = sbert_processor.process_subject(
            statements,
            cached_embeddings=None,
            progress_callback=None
        )
        
        print()
        print(f"  ✓ SBERT processing complete!")
        print(f"  - Found {len(groups_pairwise):,} similar pairs")
        print(f"  - Non-duplicate files: {non_duplicate_count:,}")
    except Exception as e:
        print(f"  ❌ ERROR: SBERT processing failed: {e}")
        import traceback
        traceback.print_exc()
        return
    finally:
        sbert_processor.stop()
    print()
    
    # Step 5: Identify non-duplicate files and save to saved-track
    print("[Step 5] Identifying non-duplicate files...")
    
    # Find all files that appear in similar pairs
    files_in_pairs = set()
    for group in groups_pairwise:
        files_in_pairs.update(group['files'])
    
    # Non-duplicates are files NOT in any pair
    non_duplicate_files = set(statements.keys()) - files_in_pairs
    
    print(f"  - Files in similar pairs: {len(files_in_pairs):,}")
    print(f"  - Non-duplicate files: {len(non_duplicate_files):,}")
    print()
    
    # Merge with existing saved-track and save
    print("[Step 6] Saving non-duplicate files to saved-track...")
    all_saved = existing_saved.union(non_duplicate_files)
    newly_saved = non_duplicate_files - existing_saved
    
    # Sort numerically
    sorted_saved = sort_filenames_numerically(list(all_saved))
    
    # Ensure output directory exists
    saved_track_path = Path(SAVED_TRACK_FILE)
    saved_track_path.parent.mkdir(parents=True, exist_ok=True)
    
    try:
        with open(SAVED_TRACK_FILE, 'w', encoding='utf-8') as f:
            json.dump(sorted_saved, f, indent=2)
        print(f"  ✓ Saved {len(sorted_saved):,} files to saved-track")
        print(f"  - Existing saved files: {len(existing_saved):,}")
        print(f"  - Newly saved files: {len(newly_saved):,}")
    except Exception as e:
        print(f"  ❌ ERROR: Failed to save saved-track file: {e}")
        return
    print()
    
    # Step 7: Filter groups to similarity range
    print(f"[Step 7] Filtering groups to similarity range {MIN_SIMILARITY * 100:.1f}% - {MAX_SIMILARITY * 100:.1f}%...")
    filtered_groups = []
    for group in groups_pairwise:
        similarity = group.get('similarity', 0)
        if MIN_SIMILARITY <= similarity <= MAX_SIMILARITY:
            filtered_groups.append(group)
    
    print(f"  ✓ Found {len(filtered_groups):,} groups in similarity range")
    print()
    
    # Step 8: Generate and display report
    print("=" * 80)
    print("PROCESSING REPORT")
    print("=" * 80)
    print(f"Total files in input folder: {len(json_files):,}")
    print(f"Files excluded (removed-track): {excluded_removed:,}")
    print(f"Files excluded (saved-track): {excluded_saved:,}")
    print(f"Files processed by SBERT: {len(all_mcqs):,}")
    print()
    print(f"SBERT Results:")
    print(f"  - Total similar pairs found: {len(groups_pairwise):,}")
    print(f"  - Pairs in similarity range ({MIN_SIMILARITY * 100:.1f}%-{MAX_SIMILARITY * 100:.1f}%): {len(filtered_groups):,}")
    print(f"  - Files in similar pairs: {len(files_in_pairs):,}")
    print(f"  - Non-duplicate files (saved): {len(non_duplicate_files):,}")
    print()
    
    # Show similarity distribution
    if similarity_bins:
        print(f"Similarity Distribution:")
        for bin_info in similarity_bins:
            if bin_info['count'] > 0:
                print(f"  - {bin_info['range']}%: {bin_info['count']:,} pairs")
    print()
    
    if len(filtered_groups) == 0:
        print("  ℹ No groups found in specified similarity range.")
        print("  ✓ Non-duplicate files have been saved to saved-track.")
        print("  ✓ Processing complete - nothing to remove.")
        print("=" * 80)
        return
    
    print(f"Next Steps:")
    print(f"  - Will process {len(filtered_groups):,} similar pairs")
    print(f"  - Will select best MCQ from each pair")
    print(f"  - Will mark unselected files for removal")
    print("=" * 80)
    print()
    
    # Step 9: Ask for user confirmation
    print("⚠️  READY TO PROCEED WITH SELECTION AND REMOVAL")
    print()
    response = input("Do you want to proceed with selecting MCQs and updating removed-track? (yes/no): ").strip().lower()
    print()
    
    if response not in ['yes', 'y']:
        print("❌ User cancelled. Exiting without updating removed-track.")
        print("✓ Non-duplicate files have been saved to saved-track.")
        return
    
    print("✓ Proceeding with selection and removal...")
    print()
    
    # Step 10: Process groups and track selections
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

