import json
import logging
import os
import tempfile


class CfsMaterialDb:
    def __init__(self, config):
        self.printer = config.get_printer()
        self.gcode = self.printer.lookup_object("gcode")
        self.material_db_path = "/usr/data/creality/userdata/box/material_database.json"
        self.generic_material_ids = {
            "PLA": "00001",
            "PETG": "00003",
            "ABS": "00004",
            "TPU": "00005",
            "ASA": "00007",
            "PA": "00008",
            "PC": "00021",
        }
        self.gcode.register_command(
            "CFS_SET_MATERIAL_DB_TEMP",
            self.cmd_CFS_SET_MATERIAL_DB_TEMP,
            desc=self.cmd_CFS_SET_MATERIAL_DB_TEMP_help,
        )

    cmd_CFS_SET_MATERIAL_DB_TEMP_help = "update kvParam.nozzle_temperature by material database id"

    def _load_database(self):
        with open(self.material_db_path, "r") as handle:
            return json.load(handle)

    def _find_item_by_id(self, data, material_id):
        items = data.get("result", {}).get("list", [])
        for item in items:
            base = item.get("base") or {}
            if str(base.get("id", "")).strip() == material_id:
                return item
        return None

    def _write_database(self, data):
        directory = os.path.dirname(self.material_db_path)
        fd, temp_path = tempfile.mkstemp(prefix="material_database.", suffix=".json", dir=directory)
        try:
            with os.fdopen(fd, "w") as handle:
                json.dump(data, handle, ensure_ascii=False)
            os.replace(temp_path, self.material_db_path)
        except Exception:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
            raise

    def _read_purge_temps(self):
        data = self._load_database()
        result = {}
        for material_type, material_id in self.generic_material_ids.items():
            item = self._find_item_by_id(data, material_id)
            if not item:
                result[material_type.lower()] = None
                continue
            kv = item.get("kvParam") or {}
            result[material_type.lower()] = kv.get("nozzle_temperature")
        return result

    def get_status(self, eventtime):
        try:
            return {"purge_temps": self._read_purge_temps()}
        except Exception as err:
            logging.exception("cfs_material_db get_status failed")
            return {
                "purge_temps": {"pla": None, "petg": None},
                "error": str(err),
            }

    def cmd_CFS_SET_MATERIAL_DB_TEMP(self, gcmd):
        material_id = gcmd.get("ID", default="").strip()
        temperature = gcmd.get("TEMP", default="").strip()
        if not material_id:
            gcmd.respond_info("[CFS_SET_MATERIAL_DB_TEMP] missing ID")
            return
        if not temperature:
            gcmd.respond_info("[CFS_SET_MATERIAL_DB_TEMP] missing TEMP")
            return

        try:
            temp_value = int(round(float(temperature)))
        except Exception:
            gcmd.respond_info("[CFS_SET_MATERIAL_DB_TEMP] invalid TEMP=%s" % (temperature,))
            return

        try:
            data = self._load_database()
            target = self._find_item_by_id(data, material_id)
            if target is None:
                gcmd.respond_info("[CFS_SET_MATERIAL_DB_TEMP] id not found: %s" % (material_id,))
                return

            kv = target.setdefault("kvParam", {})
            kv["nozzle_temperature"] = str(temp_value)
            self._write_database(data)

            base = target.get("base") or {}
            logging.info(
                "[CFS_SET_MATERIAL_DB_TEMP] id=%s type=%s brand=%s name=%s nozzle_temperature=%s",
                material_id,
                base.get("meterialType", ""),
                base.get("brand", ""),
                base.get("name", ""),
                kv.get("nozzle_temperature", ""),
            )
            gcmd.respond_info(
                "[CFS_SET_MATERIAL_DB_TEMP] id=%s nozzle_temperature=%s"
                % (material_id, kv.get("nozzle_temperature", ""))
            )
        except Exception as err:
            logging.exception("CFS_SET_MATERIAL_DB_TEMP failed")
            gcmd.respond_info("[CFS_SET_MATERIAL_DB_TEMP] error: %s" % (str(err),))


def load_config(config):
    return CfsMaterialDb(config)
