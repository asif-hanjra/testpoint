#!/usr/bin/env python3
"""
Verification script for final-track system.
Tests that the new tracking system works correctly.
"""

import json
from pathlib import Path

def verify_final_track_system():
    """Verify the final-track system is working correctly"""
    
    project_root = Path(__file__).parent
    
    print("🔍 Verifying Final-Track System")
    print("=" * 60)
    
    # Check that final-db is deleted
    final_db_path = project_root / "final-db"
    if final_db_path.exists():
        print("❌ FAIL: final-db folder still exists!")
        return False
    else:
        print("✅ PASS: final-db folder deleted")
    
    # Check that final-track exists
    final_track_path = project_root / "final-track"
    if not final_track_path.exists():
        print("❌ FAIL: final-track folder doesn't exist!")
        return False
    else:
        print("✅ PASS: final-track folder exists")
    
    # Check tracking files
    print("\n📁 Checking Tracking Files:")
    
    tracking_folders = {
        "saved-track": project_root / "saved-track",
        "final-track": project_root / "final-track",
        "removed-track": project_root / "removed-track"
    }
    
    all_subjects = set()
    
    for folder_name, folder_path in tracking_folders.items():
        if folder_path.exists():
            json_files = list(folder_path.glob("*.json"))
            print(f"  {folder_name}: {len(json_files)} subjects")
            for json_file in json_files:
                subject = json_file.stem
                all_subjects.add(subject)
                
                # Verify JSON is valid
                try:
                    with open(json_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        if isinstance(data, list):
                            print(f"    ✅ {subject}: {len(data)} files tracked")
                        else:
                            print(f"    ⚠️  {subject}: Invalid format (not a list)")
                except Exception as e:
                    print(f"    ❌ {subject}: Error reading - {e}")
        else:
            print(f"  ⚠️  {folder_name}: Folder doesn't exist")
    
    # Check for conflicts (files in both final-track and removed-track)
    print("\n🔍 Checking for Conflicts:")
    conflicts_found = False
    
    for subject in all_subjects:
        final_track_file = project_root / "final-track" / f"{subject}.json"
        removed_track_file = project_root / "removed-track" / f"{subject}.json"
        
        final_files = set()
        removed_files = set()
        
        if final_track_file.exists():
            with open(final_track_file, 'r', encoding='utf-8') as f:
                final_files = set(json.load(f))
        
        if removed_track_file.exists():
            with open(removed_track_file, 'r', encoding='utf-8') as f:
                removed_files = set(json.load(f))
        
        conflicts = final_files.intersection(removed_files)
        if conflicts:
            print(f"  ⚠️  {subject}: {len(conflicts)} files in both final-track and removed-track")
            conflicts_found = True
        else:
            print(f"  ✅ {subject}: No conflicts")
    
    if not conflicts_found:
        print("\n✅ No conflicts found between final-track and removed-track")
    
    # Summary
    print("\n" + "=" * 60)
    print("📊 SUMMARY")
    print("=" * 60)
    print(f"  Total subjects tracked: {len(all_subjects)}")
    print(f"  Subjects: {', '.join(sorted(all_subjects))}")
    
    print("\n✅ Final-Track System Verification Complete!")
    return True

if __name__ == "__main__":
    verify_final_track_system()

