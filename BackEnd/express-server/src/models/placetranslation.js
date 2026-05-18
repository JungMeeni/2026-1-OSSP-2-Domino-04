'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class PlaceTranslation extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  PlaceTranslation.init({
    place_id: DataTypes.INTEGER,
    lang_code: DataTypes.STRING,
    name: DataTypes.STRING,
    address: DataTypes.STRING,
    description: DataTypes.TEXT
  }, {
    sequelize,
    modelName: 'PlaceTranslation',
  });
  return PlaceTranslation;
};