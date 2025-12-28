#!/usr/bin/env python3
"""
Migration script to convert final-db folder structure to final-track JSON files.
This script reads all files from final-db/{subject}/ folders and creates 
final-track/{subject}.json files with just the filenames.
"""

import json
import os
from pathlib import Path

def migrate_final_db_to_track():
    """Migrate all subjects from final-db to final-track"""
    
    project_root = Path(__file__).parent
    final_db_path = project_root / "final-db"
    final_track_path = project_root / "final-track"
    
    # Create final-track directory if it doesn't exist
    final_track_path.mkdir(parents=True, exist_ok=True)
    
    if not final_db_path.exists():
        print("No final-db folder found. Nothing to migrate.")
        return
    
    # Process each subject folder in final-db
    migrated_subjects = []
    for subject_folder in sorted(final_db_path.iterdir()):
        if not subject_folder.is_dir():
            continue
        
        subject_name = subject_folder.name
        print(f"\n📁 Processing subject: {subject_name}")
        
        # Get all JSON files in the subject folder
        json_files = list(subject_folder.glob("*.json"))
        
        if not json_files:
            print(f"  ⚠️  No JSON files found in {subject_name}")
            continue
        
        # Extract just the filenames
        filenames = sorted([f.name for f in json_files])
        
        # Create final-track JSON file
        final_track_file = final_track_path / f"{subject_name}.json"
        
        # Check if final-track file already exists
        existing_files = []
        if final_track_file.exists():
            try:
                with open(final_track_file, 'r', encoding='utf-8') as f:
                    existing_files = json.load(f)
                print(f"  📄 Found existing final-track with {len(existing_files)} files")
            except Exception as e:
                print(f"  ⚠️  Error reading existing final-track: {e}")
        
        # Merge: combine existing + new (union)
        all_files = sorted(list(set(existing_files + filenames)))
        
        # Save to final-track
        try:
            with open(final_track_file, 'w', encoding='utf-8') as f:
                json.dump(all_files, f, indent=2)
            
            print(f"  ✅ Migrated {len(filenames)} files to final-track/{subject_name}.json")
            if existing_files:
                print(f"     Merged with {len(existing_files)} existing files")
                print(f"     Total in final-track: {len(all_files)} files")
            
            migrated_subjects.append({
                'subject': subject_name,
                'files_migrated': len(filenames),
                'total_in_track': len(all_files)
            })
        except Exception as e:
            print(f"  ❌ Error saving final-track: {e}")
    
    # Print summary
    print("\n" + "="*60)
    print("📊 MIGRATION SUMMARY")
    print("="*60)
    
    if migrated_subjects:
        for item in migrated_subjects:
            print(f"  {item['subject']}: {item['files_migrated']} files → final-track (total: {item['total_in_track']})")
        print(f"\n✅ Successfully migrated {len(migrated_subjects)} subjects")
    else:
        print("  No subjects migrated")
    
    print("\n💡 Next steps:")
    print("  1. Verify final-track files are correct")
    print("  2. Test the application with new final-track system")
    print("  3. Once confirmed working, you can safely delete final-db folder")
    print("="*60)

if __name__ == "__main__":
    print("🚀 Starting migration from final-db to final-track...")
    migrate_final_db_to_track()
    print("\n✨ Migration complete!")

