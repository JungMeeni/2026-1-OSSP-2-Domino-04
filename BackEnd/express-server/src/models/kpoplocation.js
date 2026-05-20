'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class KpopLocation extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  KpopLocation.init({
    artist_id: DataTypes.INTEGER,
    location_name: DataTypes.STRING,
    description: DataTypes.TEXT,
    place_id: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'KpopLocation',
  });
  return KpopLocation;
};