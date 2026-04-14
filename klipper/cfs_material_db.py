import json
import logging
import os
import tempfile


GENERIC_MATERIALS = [
    {"label": "PLA", "id": "00001", "param": "PLA", "status_key": "pla"},
    {"label": "PLA-Silk", "id": "00002", "param": "PLA_SILK", "status_key": "pla_silk"},
    {"label": "PETG", "id": "00003", "param": "PETG", "status_key": "petg"},
    {"label": "ABS", "id": "00004", "param": "ABS", "status_key": "abs"},
    {"label": "TPU", "id": "00005", "param": "TPU", "status_key": "tpu"},
    {"label": "PLA-CF", "id": "00006", "param": "PLA_CF", "status_key": "pla_cf"},
    {"label": "ASA", "id": "00007", "param": "ASA", "status_key": "asa"},
    {"label": "PA", "id": "00008", "param": "PA", "status_key": "pa"},
    {"label": "PA-CF", "id": "00009", "param": "PA_CF", "status_key": "pa_cf"},
    {"label": "BVOH", "id": "00010", "param": "BVOH", "status_key": "bvoh"},
    {"label": "PVA", "id": "00011", "param": "PVA", "status_key": "pva"},
    {"label": "HIPS", "id": "00012", "param": "HIPS", "status_key": "hips"},
    {"label": "PET-CF", "id": "00013", "param": "PET_CF", "status_key": "pet_cf"},
    {"label": "PETG-CF", "id": "00014", "param": "PETG_CF", "status_key": "petg_cf"},
    {"label": "PA6-CF", "id": "00015", "param": "PA6_CF", "status_key": "pa6_cf"},
    {"label": "PAHT-CF", "id": "00016", "param": "PAHT_CF", "status_key": "paht_cf"},
    {"label": "PPS", "id": "00017", "param": "PPS", "status_key": "pps"},
    {"label": "PPS-CF", "id": "00018", "param": "PPS_CF", "status_key": "pps_cf"},
    {"label": "PP", "id": "00019", "param": "PP", "status_key": "pp"},
    {"label": "PET", "id": "00020", "param": "PET", "status_key": "pet"},
    {"label": "PC", "id": "00021", "param": "PC", "status_key": "pc"},
]


class CfsMaterialDb:
    def __init__(self, config):
        self.printer = config.get_printer()
        self.gcode = self.printer.lookup_object("gcode")
        self.material_db_path = "/usr/data/creality/userdata/box/material_database.json"
        self.generic_materials = GENERIC_MATERIALS
        self.gcode.register_command(
            "CFS_SET_MATERIAL_DB_TEMP",
            self.cmd_CFS_SET_MATERIAL_DB_TEMP,
            desc=self.cmd_CFS_SET_MATERIAL_DB_TEMP_help,
        )
        self.gcode.register_command(
            "CFS_SET_MATERIAL_DB_TEMPS",
            self.cmd_CFS_SET_MATERIAL_DB_TEMPS,
            desc=self.cmd_CFS_SET_MATERIAL_DB_TEMPS_help,
        )

    cmd_CFS_SET_MATERIAL_DB_TEMP_help = "update kvParam.nozzle_temperature by material database id"
    cmd_CFS_SET_MATERIAL_DB_TEMPS_help = "update multiple generic material purge temperatures in one write"

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

    def _normalize_temp(self, value):
        return str(int(round(float(value))))

    def _set_target_temp(self, target, temp_value):
        kv = target.setdefault("kvParam", {})
        kv["nozzle_temperature"] = temp_value
        kv["nozzle_temperature_initial_layer"] = temp_value
        return kv

    def _read_purge_temps(self):
        data = self._load_database()
        result = {}
        for material in self.generic_materials:
            item = self._find_item_by_id(data, material["id"])
            if not item:
                result[material["status_key"]] = None
                continue
            kv = item.get("kvParam") or {}
            result[material["status_key"]] = kv.get("nozzle_temperature")
        return result

    def get_status(self, eventtime):
        try:
            return {"purge_temps": self._read_purge_temps()}
        except Exception as err:
            logging.exception("cfs_material_db get_status failed")
            return {"purge_temps": {}, "error": str(err)}

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
            temp_value = self._normalize_temp(temperature)
        except Exception:
            gcmd.respond_info("[CFS_SET_MATERIAL_DB_TEMP] invalid TEMP=%s" % (temperature,))
            return

        try:
            data = self._load_database()
            target = self._find_item_by_id(data, material_id)
            if target is None:
                gcmd.respond_info("[CFS_SET_MATERIAL_DB_TEMP] id not found: %s" % (material_id,))
                return

            kv = self._set_target_temp(target, temp_value)
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

    def cmd_CFS_SET_MATERIAL_DB_TEMPS(self, gcmd):
        updates = []
        for material in self.generic_materials:
            raw_value = gcmd.get(material["param"], default=None)
            if raw_value in (None, ""):
                continue
            try:
                updates.append((material, self._normalize_temp(raw_value)))
            except Exception:
                gcmd.respond_info(
                    "[CFS_SET_MATERIAL_DB_TEMPS] invalid %s=%s" % (material["param"], raw_value)
                )
                return

        if not updates:
            gcmd.respond_info("[CFS_SET_MATERIAL_DB_TEMPS] no values provided")
            return

        try:
            data = self._load_database()
            applied = []
            for material, temp_value in updates:
                target = self._find_item_by_id(data, material["id"])
                if target is None:
                    continue
                self._set_target_temp(target, temp_value)
                applied.append("%s=%s" % (material["param"], temp_value))
            if not applied:
                gcmd.respond_info("[CFS_SET_MATERIAL_DB_TEMPS] no matching ids found")
                return
            self._write_database(data)
            logging.info("[CFS_SET_MATERIAL_DB_TEMPS] %s", " ".join(applied))
            gcmd.respond_info("[CFS_SET_MATERIAL_DB_TEMPS] %s" % (" ".join(applied),))
        except Exception as err:
            logging.exception("CFS_SET_MATERIAL_DB_TEMPS failed")
            gcmd.respond_info("[CFS_SET_MATERIAL_DB_TEMPS] error: %s" % (str(err),))


def load_config(config):
    return CfsMaterialDb(config)
